# Security

## What this card can reach

It runs in your browser, as part of Home Assistant's frontend, with whatever access the
logged-in user has. To draw a chart it reads the state and attributes of the entities you
give it, and — for history charts — their recorded history and long-term statistics through
Home Assistant's own connection.

It does not make network requests of its own: no fonts, scripts or data are fetched from
anywhere else, and it has no chart library or other third-party code beyond
[Lit](https://lit.dev). It never writes to your configuration; the visual editor hands its
changes to Home Assistant's dashboard editor, which saves them when you press Save.

Names and values from Home Assistant are drawn as text, never as markup.

## Reporting something

Please report privately through [GitHub's advisory form][advisory] rather than opening an
issue, and give it a few days before saying anything publicly.

Useful things to include: what an attacker would gain, the card configuration that shows it,
and the Home Assistant version. A proof of concept is welcome but not required.

[advisory]: https://github.com/tempus2016/chartdeck/security/advisories/new
