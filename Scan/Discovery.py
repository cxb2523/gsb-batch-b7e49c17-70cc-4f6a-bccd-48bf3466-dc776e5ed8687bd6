from Global import (
    Flags, Domains, Threads, Details,
    Subfinder_command, Naabu_command, DNSX_Naabu_command, DNSX_bruteforce_command, HTTPX_command,
)
import Global
import subprocess
import sys
import re
import os
import socket
import threading
from Scan.CommandRun import command_exec
from Scan.Helpers import delete_http_duplicates, get_random_string, get_domains_for_enumeration

WILDCARD_PROBE_TIMEOUT = 7  # Seconds to wait for each DNS answer for the non-existent subdomain
WILDCARD_PROBE_ATTEMPTS = 2  # Probes per domain; one answer is enough, a domain is treated as timed out only if every probe timed out


def _probe_wildcard_once(domain, resolver, timeout):
    # Returns "wildcard" (the random subdomain resolved), "none" (confirmed not to resolve)
    # or "timeout" (no DNS answer within the timeout).
    probe = get_random_string(10).lower() + '.' + domain
    if '-v' in Flags:
        print(f"[v] Resolving {probe} to check {domain} for a DNS wildcard")
    result = {"state": "timeout"}

    def resolve():
        try:
            resolver(probe, None)
            result["state"] = "wildcard"
        except OSError:
            result["state"] = "none"
        except Exception:
            result["state"] = "timeout"  # An unexpected resolver failure must not mark a domain as a wildcard

    worker = threading.Thread(target=resolve, daemon=True)
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        print(f"[!] Wildcard check for {domain} timed out after {timeout}s while resolving {probe}")
    return result["state"]


def detect_dns_wildcard(domain, resolver=None,
                        timeout=WILDCARD_PROBE_TIMEOUT, attempts=WILDCARD_PROBE_ATTEMPTS):
    # A domain with a DNS wildcard resolves ANY subdomain, so subdomain enumeration would mark
    # thousands of non-existent hosts as alive. Only a positive "it resolved" answer marks a domain
    # as wildcard: timeouts and errors fall back to normal processing.
    if resolver is None:  # Resolved at call time (not as a default argument) so tests can patch socket.getaddrinfo
        resolver = socket.getaddrinfo
    timed_out = True
    for _ in range(max(1, attempts)):
        state = _probe_wildcard_once(domain, resolver, timeout)
        if state == "wildcard":
            return "wildcard"
        if state == "none":
            timed_out = False
    return "timeout" if timed_out else "none"


def check_dns_wildcards():
    # A domain with a DNS wildcard resolves ANY subdomain, so subdomain enumeration would mark
    # thousands of non-existent hosts as alive. For such domains only the root domain is scanned,
    # exactly like with the -ds flag. Uses the system resolver, so it can run in parallel with the
    # installed-tools check without waiting for dnsx/httpx. Each probe is bounded by its own
    # timeout, so a hanging resolver can never keep a domain in the enumeration input silently.
    wildcard_domains = []
    timed_out_domains = []
    results = {}
    results_lock = threading.Lock()

    def probe_domain(domain):
        state = detect_dns_wildcard(domain)
        with results_lock:
            results[domain] = state

    print("[*] Checking if subdomain enumeration is possible...")
    threads = [threading.Thread(target=probe_domain, args=(domain,), daemon=True) for domain in Global.Domains]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()  # Every probe already carries its own per-attempt timeout, so this join always returns

    for domain in Global.Domains:
        state = results.get(domain, "timeout")
        if state == "wildcard":
            wildcard_domains.append(domain)
        elif state == "timeout":
            timed_out_domains.append(domain)

    for domain in wildcard_domains:
        print(f"[e] {domain} resolves any non-existent subdomain, so subdomain enumeration would return only false results!")
    if wildcard_domains:
        Global.WildcardDomains.extend(wildcard_domains)
        print(f"[!] Subdomains will not be enumerated for {', '.join(wildcard_domains)} - only the root domain itself is scanned there")
        Global.GeneralInfoNotes.append("Subdomain enumeration was skipped because any non-existent subdomain resolves, so only "
                                       f"the root domain itself was scanned for: {', '.join(wildcard_domains)}")
    if timed_out_domains:
        print(f"[!] Wildcard DNS check did not get a DNS answer in time for: {', '.join(timed_out_domains)}. "
              "These domains are processed normally (subdomain enumeration is enabled for them).")
        Global.GeneralInfoNotes.append("The wildcard DNS check timed out and could not confirm whether any non-existent subdomain "
                                       f"resolves, so subdomain enumeration ran normally for: {', '.join(timed_out_domains)}")


def launch_httpx():
    def delete_443_80_ports_from_assets():
        for i in range(len(Global.HTTPAssets)):
            Global.HTTPAssets[i] = re.sub(r':(?:80|443)$', '', Global.HTTPAssets[i])
        Global.HTTPAssets = list(dict.fromkeys(Global.HTTPAssets))

    input_data = '\n'.join(Global.Services) + '\n'
    command = HTTPX_command.substitute(HTTPXthreads=Threads[Global.LoadLevel]['HTTPXthreads'],
                                       HTTPXrate=Threads[Global.LoadLevel]['HTTPXrate'])
    print("[*] Searching for HTTP services...")
    if '-v' in Flags:
        print("[v] Executing command: " + command)
    result = command_exec(command, "HTTPX.txt", input_data)

    if result != "-":
        Global.HTTPAssets.extend(delete_http_duplicates(result))
        delete_443_80_ports_from_assets()
        print(f"[+] {len(Global.HTTPAssets)} active web services will be scanned")
    else:
        print("[e] Error when running HTTPX utility.")
        sys.exit(1)


def bruteforce_subdomains(console_output=True):
    dict_path = Global.CustomSubdomainsDict if Global.CustomSubdomainsDict else Details[Global.DetailsLevel]['SubdomainsDict']
    if not os.path.exists(dict_path):
        print(f"[!] Subdomains wordlist {dict_path} was not found! Skipping subdomains bruteforce.")
        return

    domains_file = Global.RunDir + "/bruteforce_domains.txt"
    with open(domains_file, "w", encoding="utf-8") as file:
        file.write('\n'.join(get_domains_for_enumeration()) + '\n')

    command = DNSX_bruteforce_command.substitute(dnsxThreads=Threads[Global.LoadLevel]['DNSX'], SubdomainsDict=dict_path, DomainsFile=domains_file)
    if console_output:
        print("[*] Bruteforcing subdomains...")
    if '-v' in Flags:
        print("[v] Executing command: " + command)
    result = command_exec(command, "DNSX_bruteforce.txt")  # Via command_exec so this step (unlike subfinder/DNSX) can be skipped with Ctrl+C

    if result != "-":
        Global.RawSubdomains.extend([x for x in result if x])
        Global.RawSubdomains = list(dict.fromkeys(Global.RawSubdomains))
        Global.RawSubdomains = [x for x in Global.RawSubdomains if x not in Global.ExcludedHosts]
    else:
        print("[e] Error when running DNSX utility for subdomains bruteforce.")
        sys.exit(1)


def launch_subfinder_dnsx_naabu(scan_subdomains, console_output=True):
    input_data = '\n'.join(Global.Domains) + '\n'

    if '-i' in Flags:
        command = Naabu_command.substitute(
            NaabuThreads=Threads[Global.LoadLevel]['NaabuThreads'],
            NaabuRate=Threads[Global.LoadLevel]['NaabuRate'],
            NaabuPorts=Details[Global.DetailsLevel]['NaabuPorts'],
            NaabuFlags=Details[Global.DetailsLevel]['NaabuFlags'])
        if console_output:
            print("[*] Getting open network services on specified IP addresses...")
    else:
        if scan_subdomains:
            if console_output:
                print("[*] Searching subdomains...")
            if '-v' in Flags:
                print("[v] Executing command: " + Subfinder_command)
            result = subprocess.run(Subfinder_command, shell=True, capture_output=True, text=True,
                                    input='\n'.join(get_domains_for_enumeration()) + '\n')

            if result.returncode == 0:
                Global.RawSubdomains.extend(result.stdout.splitlines())
                Global.RawSubdomains = [x for x in Global.RawSubdomains if x not in Global.ExcludedHosts]
                bruteforce_subdomains(console_output)
                input_data = '\n'.join(Global.RawSubdomains) + '\n' + '\n'.join(Global.Domains) + '\n'
            else:
                print("[e] Error when running Subfinder utility:")
                print("[e] Command: " + Subfinder_command)
                print("[e] Error: " + result.stderr)
                sys.exit(1)
        else:
            Global.RawSubdomains.extend(Global.Domains)
            Global.RawSubdomains = [x for x in Global.RawSubdomains if x not in Global.ExcludedHosts]

        command = DNSX_Naabu_command.substitute(
            dnsxThreads=Threads[Global.LoadLevel]['DNSX'],
            NaabuThreads=Threads[Global.LoadLevel]['NaabuThreads'],
            NaabuRate=Threads[Global.LoadLevel]['NaabuRate'],
            NaabuPorts=Details[Global.DetailsLevel]['NaabuPorts'],
            NaabuFlags=Details[Global.DetailsLevel]['NaabuFlags'])
        if console_output:
            print("[*] Getting open network services...")

    if '-v' in Flags:
        print("[v] Executing command: " + command)
    result = subprocess.run(command, shell=True, capture_output=True, text=True, input=input_data)

    if result.returncode == 0:
        Global.Services.extend(result.stdout.splitlines())
        Global.Services = list(dict.fromkeys(Global.Services))
        if '-ba' in Flags or '-bw' in Flags or '-bf' in Flags:
            Global.Services = [s for s in Global.Services if not s.startswith('localhost.')]
    else:
        print("[e] Error when running Subfinder, DNSX or Naabu utilities:")
        print("[e] Command: " + command)
        print("[e] Error: " + result.stderr)
        sys.exit(1)
