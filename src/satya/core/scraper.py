import contextlib
import ipaddress
import socket
import threading
from urllib.parse import urlparse, urljoin

import requests
from bs4 import BeautifulSoup
import markdownify

from . import storage
from .git_handler import GitHandler

# Maximum number of redirect hops followed before giving up.
MAX_REDIRECTS = 5

# Serializes the validate -> pin -> request window so concurrent scrapes
# cannot observe each other's pinned DNS answers.
_FETCH_LOCK = threading.RLock()


def _resolve_global_ips(hostname):
    """Resolve *hostname* and return its IPs only if EVERY resolved address
    is globally routable.

    Returns a non-empty list of IP strings on success, or None if resolution
    fails or any address is loopback, private, link-local (e.g. cloud
    metadata endpoints), multicast, or otherwise non-global.
    """
    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except Exception:
        return None
    ips = []
    for result in addr_info:
        ip_str = result[4][0]
        try:
            ip_obj = ipaddress.ip_address(ip_str)
        except ValueError:
            return None
        if not ip_obj.is_global:
            return None
        ips.append(ip_str)
    return ips or None


def _is_safe_url(url: str) -> bool:
    """Validates if a URL is safe to fetch, preventing SSRF."""
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        return False
    if not parsed.hostname:
        return False
    return _resolve_global_ips(parsed.hostname) is not None


def _addrinfo_for(ip_str, port):
    """Build a getaddrinfo-style result tuple for a literal IP."""
    family = socket.AF_INET6 if ':' in ip_str else socket.AF_INET
    if family == socket.AF_INET6:
        sockaddr = (ip_str, port, 0, 0)
    else:
        sockaddr = (ip_str, port)
    return (family, socket.SOCK_STREAM, 6, '', sockaddr)


@contextlib.contextmanager
def _pinned_dns(hostname, ips):
    """Pin DNS resolution for *hostname* to the pre-validated *ips*.

    requests/urllib3 resolve the hostname again when opening the socket,
    which is what makes DNS-rebinding (TOCTOU) attacks possible: the first
    answer (validated) can be public while the second (used for the actual
    connection) points at an internal address. By pinning getaddrinfo for
    the duration of the request, every actual connection is forced onto
    exactly the IPs we validated.

    The URL itself is left untouched, so the Host header, TLS SNI and
    certificate verification all keep using the original hostname, and
    certificate verification stays enabled.
    """
    original_getaddrinfo = socket.getaddrinfo
    pinned_hosts = {hostname}
    try:
        # urllib3 may resolve the IDNA/punycode form of the hostname.
        pinned_hosts.add(hostname.encode('idna').decode('ascii'))
    except Exception:
        pass

    def _getaddrinfo(host, port, *args, **kwargs):
        if host in pinned_hosts:
            return [_addrinfo_for(ip, port if port is not None else 0) for ip in ips]
        return original_getaddrinfo(host, port, *args, **kwargs)

    socket.getaddrinfo = _getaddrinfo
    try:
        yield
    finally:
        socket.getaddrinfo = original_getaddrinfo


class Scraper:
    def __init__(self, repo_path="."):
        self.repo_path = repo_path
        self.git_handler = GitHandler(repo_path)
        storage.ensure_satya_dirs()

    def fetch_and_save(self, url, title=None):
        try:
            current_url = url
            response = None
            redirects = 0

            # Hold the lock across the whole redirect chain so the pinned-DNS
            # window of one fetch cannot leak into a concurrent one.
            with _FETCH_LOCK:
                while True:
                    parsed = urlparse(current_url)
                    if parsed.scheme not in ('http', 'https'):
                        print(f"Error scraping {current_url}: Unsupported URL scheme.")
                        return None
                    if not parsed.hostname:
                        print(f"Error scraping {current_url}: Missing hostname.")
                        return None

                    # Validate EVERY hop: each redirect target is resolved and
                    # checked again before any connection is made to it.
                    ips = _resolve_global_ips(parsed.hostname)
                    if ips is None:
                        print(f"Error scraping {current_url}: URL resolved to unsafe IP.")
                        return None

                    try:
                        # Force the actual connection onto the validated IPs.
                        with _pinned_dns(parsed.hostname, ips):
                            response = requests.get(current_url, timeout=10, allow_redirects=False)
                    except requests.exceptions.Timeout:
                        print(f"Error scraping {current_url}: Request timed out.")
                        return None
                    except requests.exceptions.RequestException as e:
                        print(f"Error scraping {current_url}: Request failed: {e}")
                        return None

                    if 300 <= response.status_code < 400 and 'location' in response.headers:
                        redirects += 1
                        if redirects > MAX_REDIRECTS:
                            print(f"Error scraping {url}: Too many redirects.")
                            return None
                        # Resolve relative redirects using urljoin
                        current_url = urljoin(current_url, response.headers['location'])
                        continue
                    break

            if response is None:
                print(f"Error scraping {url}: No response received.")
                return None

            response.raise_for_status()

            soup = BeautifulSoup(response.content, 'html.parser')
            if not title:
                if soup.title:
                    title = soup.title.string.strip()
                else:
                    title = "untitled_page"

            safe_title = "".join([c for c in title if c.isalnum() or c in (' ', '-', '_')]).strip().replace(' ', '_')
            filename = f"{safe_title}.md"

            markdown_content = markdownify.markdownify(response.text, heading_style="ATX")

            full_content = f"# {title}\n\nSource: {url}\n\n---\n\n{markdown_content}\n\n---\n*Scraped autonomously via [Satya Agent Tracker](https://github.com/anktechsol/Satya_AI)*"

            saved_path = storage.save_markdown(filename, full_content)

            if saved_path:
                self.git_handler.commit_and_push([saved_path], f"Added Truth Source: {title}")
                return filename
            return None

        except Exception as e:
            print(f"Error scraping {url}: {e}")
            return None

    def list_sources(self):
        return storage.list_truth_files()
