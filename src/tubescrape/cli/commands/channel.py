from __future__ import annotations

import click

from tubescrape.cli.output import (
    print_browse_results,
    print_channel_playlists_results,
    print_search_results,
    print_shorts_results,
)


@click.group(invoke_without_command=True)
@click.argument('channel')
@click.option('--max-results', '-n', default=30, type=int, help='Max videos (0=all).')
@click.option('--json', 'output_json', is_flag=True, help='Output as JSON.')
@click.pass_context
def channel(ctx: click.Context, channel: str, max_results: int, output_json: bool) -> None:
    """Browse a YouTube channel's content.

    CHANNEL is a channel ID, @handle, or full URL.

    Without a subcommand, shows the channel's videos (default).

    \b
    Examples:
        tubescrape channel @lexfridman
        tubescrape channel @lexfridman shorts
        tubescrape channel @lexfridman playlists
        tubescrape channel @lexfridman search "podcast"
    """
    ctx.ensure_object(dict)
    ctx.obj['channel_arg'] = channel
    ctx.obj['max_results'] = max_results
    ctx.obj['output_json'] = output_json

    # Default behavior: show videos if no subcommand
    if ctx.invoked_subcommand is None:
        from tubescrape import YouTube

        proxy = ctx.obj.get('proxy')
        yt = YouTube(proxy=proxy)
        try:
            result = yt.get_channel_videos(channel, max_results=max_results)
            print_browse_results(result, output_json=output_json)
        finally:
            yt.close()


@channel.command()
@click.pass_context
def shorts(ctx: click.Context) -> None:
    """Browse a channel's Shorts."""
    from tubescrape import YouTube

    proxy = ctx.obj.get('proxy')
    channel_arg = ctx.obj['channel_arg']
    output_json = ctx.obj['output_json']

    yt = YouTube(proxy=proxy)
    try:
        result = yt.get_channel_shorts(channel_arg)
        print_shorts_results(result, output_json=output_json)
    finally:
        yt.close()


@channel.command('playlists')
@click.pass_context
def playlists_cmd(ctx: click.Context) -> None:
    """Browse a channel's playlists."""
    from tubescrape import YouTube

    proxy = ctx.obj.get('proxy')
    channel_arg = ctx.obj['channel_arg']
    output_json = ctx.obj['output_json']

    yt = YouTube(proxy=proxy)
    try:
        result = yt.get_channel_playlists(channel_arg)
        print_channel_playlists_results(result, output_json=output_json)
    finally:
        yt.close()


@channel.command('search')
@click.argument('query')
@click.option('--max-results', '-n', default=0, type=int, help='Max results (0=all).')
@click.pass_context
def search_cmd(ctx: click.Context, query: str, max_results: int) -> None:
    """Search within a channel's videos.

    QUERY is the search query string.
    """
    from tubescrape import YouTube

    proxy = ctx.obj.get('proxy')
    channel_arg = ctx.obj['channel_arg']
    output_json = ctx.obj['output_json']

    yt = YouTube(proxy=proxy)
    try:
        result = yt.search_channel(channel_arg, query, max_results=max_results)
        print_search_results(result, output_json=output_json)
    finally:
        yt.close()
