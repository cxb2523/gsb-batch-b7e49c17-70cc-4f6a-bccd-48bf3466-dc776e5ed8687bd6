import { type ReactNode, useState } from "react"
import { Box, Plate, Press } from "react-isokit"
import { CopyCommand } from "../app/copy-command"
import { GITHUB_REPO, pusharyFrom } from "../app/links"
import { href } from "../app/route-store"
import { SiteFooter } from "../app/site-footer"
import { SiteHeader } from "../app/site-header"
import { GETTING_STARTED } from "../catalog/getting-started"
import { ApprovalPad } from "../figures/agents/approval-pad"
import { DeskComputer } from "../figures/agents/desk-computer"
import { EdgeBox } from "../figures/agents/edge-box"
import { PagePress } from "../figures/agents/page-press"
import { SoundBoard } from "../figures/agents/sound-board"
import { TallyCounter } from "../figures/agents/tally-counter"
import { PUSHARY_ICON } from "../logos/agent-logos"

const SNIPPET = `import { useState } from "react"
import { Box, Plate, Press } from "react-isokit"
import "react-isokit/styles.css"

const key = { x: 0, y: 0, z: 0, w: 60, d: 60, h: 14 }

export function Key() {
  const [n, setN] = useState(0)
  return (
    <Plate label="A key" fit={[key]} readout={\`pressed \${n}×\`}>
      <Press label="Press the key" onPress={() => setN(n + 1)}>
        <g><Box {...key} r={10} /></g>
      </Press>
    </Plate>
  )
}`

const KEY = { x: 0, y: 0, z: 0, w: 60, d: 60, h: 14 }

function TinyKey(): ReactNode {
  const [presses, setPresses] = useState(0)
  return (
    <Plate label="A single key" fit={[KEY]} aspect={1.5} readout={`pressed ${presses}×`} hint="Press it">
      <Press label="Press the key" onPress={() => setPresses(presses + 1)}>
        <g>
          <Box {...KEY} r={10} />
        </g>
      </Press>
    </Plate>
  )
}


export function HomePage(): ReactNode {
  return (
    <>
      <SiteHeader />

      <main>
        <section className="hero">
          <p className="eyebrow">Free and open source · React</p>
          <h1>
            Little drawings.
            <br />
            Made to be clicked.
          </h1>
          <p className="lede">Add interactive illustrations to your website. Start with an example, or ask your coding agent to draw one. Change the colours, add sound, and make it yours.</p>
          <div className="cta">
            <a className="button" href={href("figures")}>Explore the examples <span aria-hidden="true">→</span></a>
            <a className="button button-secondary" href="#agent">Make your own</a>
          </div>
          <p className="maker">A small React library. Free for personal and commercial projects. No account needed.</p>
        </section>

        <figure className="wide">
          <DeskComputer />
          <figcaption className="demo-caption"><span>Try it. Click the computer to switch it on, then type.</span><a href={href("figures", "desk-computer")}>Open this example →</a></figcaption>
        </figure>

        <div className="grid">
          <figure>
            <ApprovalPad />
            <figcaption>
              <strong><a href={href("figures", "approval-pad")}>Approval pad</a></strong>
              <span>Press a button to approve or stop a task.</span>
            </figcaption>
          </figure>
          <figure>
            <PagePress />
            <figcaption>
              <strong><a href={href("figures", "page-press")}>Page builder</a></strong>
              <span>Press to build a page, one block at a time.</span>
            </figcaption>
          </figure>
          <figure>
            <EdgeBox />
            <figcaption>
              <strong><a href={href("figures", "edge-box")}>File reader</a></strong>
              <span>Pick a folder and watch it load.</span>
            </figcaption>
          </figure>
        </div>

        <section className="agent" id="agent">
          <div className="section-head">
            <p className="eyebrow">Make your own</p>
            <h2>Describe it. Then try it.</h2>
            <p>You need a React project and a coding agent. Prefer to write the code yourself? <a href={href("components")}>Read the component docs</a>.</p>
          </div>
          <ol className="steps">
            {GETTING_STARTED.map((s, i) => (
              <li key={s.title}>
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
                <CopyCommand text={s.command} />
              </li>
            ))}
          </ol>
        </section>

        <section className="split">
          <div>
            <p className="eyebrow">Sound</p>
            <h2>Twenty sounds, no files.</h2>
            <p>Every key clicks like what it is made of, sounds lower when it is bigger and sits where it is drawn in stereo. Mechanisms tick, latch, relay, hum and roll, and results chime. The browser makes the sounds, so there are no audio files to download. Sound is optional.</p>
            <pre>
              <code>{`configureSound({ defaultOn: true })
playSound("cascade", { count: 4, stagger: 0.06 })
playSound("motor", { duration: 0.9 })`}</code>
            </pre>
          </div>
          <SoundBoard />
        </section>

        <section className="themes">
          <div className="section-head">
            <p className="eyebrow">Theming</p>
            <h2>Same figure, your colours.</h2>
            <p>Light and dark come built in. Import react-isokit/themes.css for three looks, each with a light and a dark version: blueprint draws the figure on isometric graph paper, paper inks it in sepia, phosphor makes it glow like a terminal.</p>
          </div>
          <div className="grid">
            <div data-look="blueprint">
              <TallyCounter theme="Blueprint" />
            </div>
            <div data-look="paper">
              <TallyCounter theme="Paper" />
            </div>
            <div data-look="phosphor">
              <TallyCounter theme="Phosphor" />
            </div>
          </div>
        </section>


        <section className="split code">
          <div>
            <p className="eyebrow">A little code</p>
            <h2>One key. Three components.</h2>
            <p>
              <code>Plate</code> holds the drawing. <code>Box</code> draws a shape. <code>Press</code> makes it clickable. Put them together and you have your first interactive illustration.
            </p>
            <pre>
              <code>{SNIPPET}</code>
            </pre>
          </div>
          <TinyKey />
        </section>
        <section className="questions" aria-labelledby="questions-title">
          <h2 id="questions-title">A few things to know.</h2>
          <dl>
            <div><dt>What is isokit?</dt><dd>A free React library for interactive isometric illustrations: small drawings with a 3D look. Use them in websites, docs and product demos.</dd></div>
            <div><dt>Can I use it in a paid project?</dt><dd>Yes. isokit is MIT licensed. You can use and change it in personal or commercial projects. <a href={`${GITHUB_REPO}/blob/main/LICENSE`}>Read the license</a>.</dd></div>
            <div><dt>Do I need an AI agent or Pushary?</dt><dd>No. You can write the React code yourself. The coding skill is there to help, and Pushary is a separate, optional tool from the same maker.</dd></div>
          </dl>
        </section>

        <aside className="pushary" aria-labelledby="pushary-title">
          <div className="pushary-brand"><img src={PUSHARY_ICON} alt="" width={36} height={36} /><span>Pushary</span><span className="pushary-note">From the maker of isokit</span></div>
          <div className="pushary-body">
            <div className="pushary-copy">
              <h2 id="pushary-title">Step away. Stay in the loop.</h2>
              <p>When your coding agent needs an answer, Pushary sends the question to your phone. Approve or decline, and get back to your day.</p>
            </div>
            <a className="button button-secondary" href={pusharyFrom("landing", "maker-card")} target="_blank" rel="noopener">See Pushary <span aria-hidden="true">↗</span></a>
          </div>
          <p className="fine">A separate tool. isokit is free to use with or without it.</p>
        </aside>
      </main>

      <SiteFooter />
    </>
  )
}
