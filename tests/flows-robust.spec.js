// Productieketen: robuustheid van de lijnen — voorraad, inklappen/verplaatsen,
// ontbrekende kaarten en opruimen bij uitzetten of resizen.
const { test, expect } = require("@playwright/test");
const { startGame, tick, game } = require("./helpers/game");
const { threshold } = require("./levels.data");

const level = (n, extra = {}) => ({ PlayerLevel: n, NextLevel: threshold(n), ...extra });

function flow(page, from, to) {
  return page.locator(`.flow[data-from="${from}"][data-to="${to}"]`);
}

// Stromen waarvan begin- of eindpunt niet op de rand van hun kaart ligt
function offCard(page) {
  return page.evaluate(() => {
    const layer = document.getElementById("flowLayer").getBoundingClientRect();
    const onBorder = (point, r) => {
      const x = point.x + layer.left;
      const y = point.y + layer.top;
      const inX = x >= r.left - 2 && x <= r.right + 2;
      const inY = y >= r.top - 2 && y <= r.bottom + 2;
      const onX = Math.abs(x - r.left) <= 2 || Math.abs(x - r.right) <= 2;
      const onY = Math.abs(y - r.top) <= 2 || Math.abs(y - r.bottom) <= 2;
      return (onX && inY) || (onY && inX);
    };
    return [...document.querySelectorAll(".flow")]
      .filter((g) => g.style.display !== "none")
      .filter((g) => {
        const a = document.getElementById(g.dataset.from).getBoundingClientRect();
        const b = document.getElementById(g.dataset.to).getBoundingClientRect();
        const path = g.querySelector(".flow-base");
        const start = path.getPointAtLength(0);
        const end = path.getPointAtLength(path.getTotalLength());
        return !onBorder(start, a) || !onBorder(end, b);
      })
      .map((g) => g.dataset.from + ">" + g.dataset.to);
  });
}

test.describe("Productieketen: tekenen en voorraad", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("lijnen lopen van rand tot rand van de zichtbare kaarten", async ({ page }) => {
    const { pageErrors } = await startGame(page, { state: level(2) });
    await tick(page, 1);
    const harvest = flow(page, "landbouw-col", "grain-col");
    await expect(harvest).toBeVisible();
    await expect(harvest.locator(".flow-base")).toHaveAttribute("d", /^M\d/);
    // Begin- en eindpunt komen uit de echte posities van de kaarten
    expect(await offCard(page)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("lege inputvoorraad: gestippelde lijn met uitleg, weer normaal na bijvullen", async ({ page }) => {
    // Graansilo start leeg: de keten graan -> windmolens heeft geen input
    await startGame(page, { state: level(2) });
    await tick(page, 1);
    const grain = flow(page, "grain-col", "windmills-col");
    await expect(grain).toHaveClass(/(^|\s)shortage(\s|$)/);
    const dash = await grain
      .locator(".flow-base")
      .evaluate((el) => getComputedStyle(el).strokeDasharray);
    expect(dash).not.toBe("none");
    // De tooltip en de hint in beeld leggen de gestippelde lijn uit
    await expect(grain.locator("title")).toHaveText(/geen grondstof op voorraad/);
    await expect(page.locator("#flowHint")).toBeVisible();
    await expect(page.locator("#flowHint")).toHaveText(/grondstof niet op voorraad/);
    // Een stroom zonder voorraadfunctie (oogst) blijft gewoon
    await expect(flow(page, "landbouw-col", "grain-col")).not.toHaveClass(/shortage/);

    await game(page, () => {
      objGrainSilo.contents = 250;
      objFlows.updateActivity();
    });
    await expect(grain).not.toHaveClass(/shortage/);
    await expect(page.locator("#flowHint")).toBeHidden();
  });

  test("inklappen, verplaatsen en resizen: de lijnen volgen de kaarten", async ({ page }) => {
    await startGame(page, { state: level(7) });
    await tick(page, 1);
    expect(await offCard(page)).toEqual([]);

    await page.locator("#navbarOptionDropdown").click();
    await page.locator("#editLayoutBTN").click();
    // Kaart inklappen (hoogte verandert) en een kaart binnen de rij verplaatsen
    await page.getByRole("button", { name: "Klap Bloem in" }).click();
    await page.getByRole("button", { name: "Graan naar links" }).click();
    await tick(page, 1);
    expect(await offCard(page)).toEqual([]);

    // Echt slepen met drag & drop: graan achter een andere kaart in dezelfde rij
    const dragged = await page.evaluate(() => {
      const card = document.getElementById("grain-col");
      const siblings = [...card.parentElement.children].filter((c) => c.id && c !== card);
      const target = siblings[siblings.length - 1];
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
      card.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
      return [...card.parentElement.children].indexOf(card);
    });
    expect(dragged).toBeGreaterThan(0);
    await tick(page, 1);
    expect(await offCard(page)).toEqual([]);

    // Venster van grootte veranderen: opnieuw tekenen, geen oude lijnen
    await page.setViewportSize({ width: 1600, height: 900 });
    await tick(page, 1);
    expect(await offCard(page)).toEqual([]);
  });

  test("onzichtbare of ontbrekende kaarten worden overgeslagen zonder fout", async ({ page }) => {
    const { pageErrors } = await startGame(page, { state: level(2) });
    await tick(page, 1);

    // Bronkaart verbergen: haar stromen verdwijnen, de rest blijft
    await game(page, () => {
      document.getElementById("grain-col").style.display = "none";
      objFlows.draw();
    });
    await expect(flow(page, "landbouw-col", "grain-col")).toBeHidden();
    await expect(flow(page, "grain-col", "windmills-col")).toBeHidden();
    await expect(flow(page, "windmills-col", "flour-col")).toBeVisible();

    // Doelkaart helemaal uit de DOM halen mag ook geen fout geven
    await game(page, () => {
      document.getElementById("flour-col").remove();
      objFlows.draw();
    });
    await expect(flow(page, "windmills-col", "flour-col")).toBeHidden();
    expect(pageErrors).toEqual([]);

    // Alles onzichtbaar: geen enkele lijn, maar wel een zichtbare melding in de laag
    await game(page, () => {
      document.querySelectorAll(".rows > [id]").forEach((card) => {
        card.style.display = "none";
      });
      objFlows.draw();
    });
    const visible = await page.evaluate(() =>
      [...document.querySelectorAll(".flow")].filter((g) => g.style.display !== "none").length
    );
    expect(visible).toBe(0);
    await expect(page.locator(".flow-empty")).toBeVisible();
    await expect(page.locator(".flow-empty")).toHaveText(/Geen zichtbare productiestromen/);
    expect(pageErrors).toEqual([]);
  });

  test("uitzetten laat geen oude lijnen achter", async ({ page }) => {
    await startGame(page, { state: level(2) });
    await tick(page, 1);
    await page.locator("#navbarOptionDropdown").click();
    await page.locator("#flowsBTN").click();
    await tick(page, 1);
    await expect(page.locator("#flowLayer")).toBeHidden();
    const leftovers = await page.evaluate(() =>
      [...document.querySelectorAll(".flow")].filter(
        (g) => g.style.display !== "none" || g.querySelector(".flow-base").getAttribute("d")
      ).length
    );
    expect(leftovers).toBe(0);
    await expect(page.locator("#flowHint")).toBeHidden();
  });
});
