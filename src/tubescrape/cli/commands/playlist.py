from __future__ import annotations

import click

from tubescrape.cli.output import print_playlist_results


@click.command()
@click.argument('playlist')
@click.option('--max-results', '-n', default=0, type=int, help='Max videos (0=all).')
@click.option('--json', 'output_json', is_flag=True, help='Output as JSON.')
@click.pass_context
def playlist(ctx: click.Context, playlist: str, max_results: int, output_json: bool) -> None:
    """Fetch videos from a YouTube playlist.

    PLAYLIST is a playlist ID or full URL.

    \b
    Examples:
        tubescrape playlist PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf
        tubescrape playlist "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
        tubescrape playlist PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf -n 10
        tubescrape playlist PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf --json
    """
    from tubescrape import YouTube

    proxy = ctx.obj.get('proxy')
    yt = YouTube(proxy=proxy)

    try:
        result = yt.get_playlist(playlist, max_results=max_results)
        print_playlist_results(result, output_json=output_json)
    finally:
        yt.close()
