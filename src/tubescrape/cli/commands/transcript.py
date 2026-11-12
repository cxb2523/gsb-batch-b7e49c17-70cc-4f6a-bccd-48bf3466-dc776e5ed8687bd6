from __future__ import annotations

import click


@click.command()
@click.argument('video')
@click.option('--lang', '-l', multiple=True, help='Preferred language code(s) in priority order.')
@click.option('--translate', '-t', 'translate_to', default=None, help='Translate to this lang.')
@click.option(
    '--format', '-f', 'fmt',
    default='text',
    type=click.Choice(['text', 'json', 'srt', 'vtt'], case_sensitive=False),
    help='Output format.',
)
@click.option('--list-languages', is_flag=True, help='List available transcript languages.')
@click.option('--no-timestamps', is_flag=True, help='Return plain text without timestamps.')
@click.option('--save', 'save_path', default=None, help='Save to file (format from ext).')
@click.option('--json', 'output_json', is_flag=True, help='Output language list as JSON.')
@click.pass_context
def transcript(
    ctx: click.Context,
    video: str,
    lang: tuple[str, ...],
    translate_to: str | None,
    fmt: str,
    list_languages: bool,
    no_timestamps: bool,
    save_path: str | None,
    output_json: bool,
) -> None:
    """Fetch transcript for a YouTube video.

    VIDEO is a video ID or full URL.

    \b
    Examples:
        tubescrape transcript dQw4w9WgXcQ
        tubescrape transcript https://www.youtube.com/watch?v=dQw4w9WgXcQ
        tubescrape transcript dQw4w9WgXcQ --format srt
        tubescrape transcript dQw4w9WgXcQ --translate es
        tubescrape transcript dQw4w9WgXcQ --save subtitles.srt
        tubescrape transcript dQw4w9WgXcQ --no-timestamps
        tubescrape transcript dQw4w9WgXcQ --list-languages
    """
    from tubescrape import YouTube
    from tubescrape.cli.output import print_transcript_languages

    proxy = ctx.obj.get('proxy')
    yt = YouTube(proxy=proxy)

    try:
        if list_languages:
            entries = yt.list_transcripts(video)
            print_transcript_languages(entries, video, output_json=output_json)
            return

        languages = list(lang) if lang else None

        result = yt.get_transcript(
            video,
            languages=languages,
            timestamps=not no_timestamps,
            translate_to=translate_to,
        )

        if save_path:
            path = result.save(save_path)
            click.echo(f'Saved to {path}')
            return

        formatted = YouTube.format_transcript(result, fmt=fmt)
        print(formatted)
    finally:
        yt.close()
