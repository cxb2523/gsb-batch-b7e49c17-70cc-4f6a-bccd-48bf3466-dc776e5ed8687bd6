from __future__ import annotations

import click


@click.command()
@click.option('--host', '-h', default='127.0.0.1', help='Bind host.')
@click.option('--port', '-p', default=8000, type=int, help='Bind port.')
@click.pass_context
def serve(ctx: click.Context, host: str, port: int) -> None:
    """Start the TubeScrape API server."""
    try:
        import uvicorn
    except ImportError:
        click.echo(
            'Error: API dependencies not installed. '
            'Install with: pip install tubescrape[api]',
            err=True,
        )
        raise SystemExit(1) from None

    from tubescrape.api.app import create_app

    proxy = ctx.obj.get('proxy')
    app = create_app(proxy=proxy)

    click.echo('Starting TubeScrape API at http://%s:%d' % (host, port))
    click.echo('Docs at http://%s:%d/docs' % (host, port))
    uvicorn.run(app, host=host, port=port)
