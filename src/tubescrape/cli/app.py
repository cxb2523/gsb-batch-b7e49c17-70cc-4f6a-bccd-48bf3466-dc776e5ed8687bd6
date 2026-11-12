from __future__ import annotations

import click

from tubescrape import __version__


@click.group()
@click.version_option(version=__version__, prog_name='tubescrape')
@click.option('--proxy', envvar='TUBESCRAPE_PROXY', default=None, help='HTTP proxy URL.')
@click.pass_context
def main(ctx: click.Context, proxy: str | None) -> None:
    """tubescrape — YouTube scraping toolkit.

    Search videos, browse channels, and fetch transcripts.
    No API key required.
    """
    ctx.ensure_object(dict)
    ctx.obj['proxy'] = proxy


def _register_commands() -> None:
    """Register CLI commands. Deferred to avoid import errors when extras not installed."""
    from tubescrape.cli.commands.channel import channel
    from tubescrape.cli.commands.playlist import playlist
    from tubescrape.cli.commands.search import search
    from tubescrape.cli.commands.transcript import transcript

    main.add_command(search)
    main.add_command(channel)
    main.add_command(playlist)
    main.add_command(transcript)

    try:
        from tubescrape.cli.commands.serve import serve
        main.add_command(serve)
    except ImportError:
        pass


_register_commands()


if __name__ == '__main__':
    main()
