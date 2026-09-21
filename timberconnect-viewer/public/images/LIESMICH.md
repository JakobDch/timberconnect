# Produktfotos (Standardbilder)

Hier liegen die **Standardbilder**, die der Viewer zu einem erfassten Produkt
zeigt — in der Anwendungsfall-Übersicht nach dem Scan und in der Bauteilkarte
des Anwendungsfalls „Rückbaubarkeit".

Welches Bild gezeigt wird, entscheidet `src/services/productImageService.ts`
anhand der erkannten Stufe der Wertschöpfungskette.

## Reihenfolge der Bildquellen

1. **Eigenes Foto des Vorgangs** — beim Registrieren eines Vorgangs kann
   optional ein Bild aufgenommen oder hochgeladen werden. Es liegt als
   `produktfoto.jpg` im WAC-geschützten Vorgangs-Container und ist über
   `product-photos.json` mit dem Ident verknüpft
   (`src/services/productPhotoService.ts`).
2. **Standardbild dieser Datei** — greift, wenn kein eigenes Foto hinterlegt
   ist. Das ist der Normalfall.
3. **SVG-Illustration** — nur als Netz, falls eine Bilddatei fehlt.

## Erwartete Dateien

Es gibt genau **vier** Produktarten — je eine pro Vorgang, der im Datenraum
einen eigenen Ident vergibt. Die Kette endet bei der BSP-Platte; ein verbautes
Bauteil bekommt keinen eigenen Ident, deshalb auch kein eigenes Bild.

| Datei | Stufe | Ident aus Vorgang | Motiv |
|---|---|---|---|
| `product-seedling.jpg` | Saatgut / Pflanzung | 1 — LGTIN des Saatgut-Loses | Forstpflanze oder Saatgutpartie |
| `product-stem.jpg` | Rundholz | 2 — SGTIN je Stamm | Gefällter Stamm / Polter im Wald |
| `product-lamella.jpg` | Schnittholz / Lamelle | 3 — SGTIN je Lamelle | Gestapelte Lamellen im Sägewerk |
| `product-clt-panel.jpg` | BSP-Platte | 4 — SGTIN der Platte | Brettsperrholzplatte, Schichtaufbau sichtbar |

**Solange eine Datei fehlt**, zeigt die App automatisch die vorhandene
SVG-Illustration (`bsp-plate-placeholder.svg` bzw.
`tree-stump-placeholder.svg`). Es entsteht also nie eine Lücke — das Foto
erscheint, sobald die Datei da ist.

Die Bilder werden beim Ablegen einmalig auf 1200×900 (4:3) beschnitten und als
JPEG mit Qualität 82 gespeichert — so bleiben sie unter 300 KB.

## Hinweise

- **Format:** JPEG, Querformat, ca. 4:3. Die Kacheln beschneiden mittig
  (`object-cover`), das Motiv sollte also mittig sitzen.
- **Größe:** 1200×900 px reichen; bitte unter ~300 KB halten, die Bilder
  werden bei jedem Seitenaufruf geladen.
- **Rechte:** Nur Fotos verwenden, für die die Nutzungsrechte im Projekt
  geklärt sind (eigene Aufnahmen oder Material der Praxispartner). Bitte keine
  Bilder aus dem Netz ohne Lizenz.
- **Austausch ohne Rebuild:** Dieser Ordner wird statisch ausgeliefert und
  nicht gebundelt. Im laufenden Container genügt:

  ```bash
  docker compose cp timberconnect-viewer/public/images/product-clt-panel.jpg \
    timberconnect-viewer:/usr/share/nginx/html/images/product-clt-panel.jpg
  ```

  Für den dauerhaften Stand die Datei hier einchecken und das Image neu bauen.

## Ketten-Illustration (`chain-*.png`)

Vier Ausschnitte aus der Grafik, die die Praxispartner mit dem Feedback vom
17.09.2026 („Feedback App_Allgemein", Folien 6–7) geliefert haben. Sie zeigen
die identifizierten Stufen der Kette und erscheinen in der
Anwendungsfall-Übersicht beim **Umfang** (`ChainScopePicker.tsx`): die
gescannte Stufe ist eingekreist, Stufen außerhalb des gewählten Umfangs sind
abgeblendet.

| Datei | Stufe | Motiv |
|---|---|---|
| `chain-seedling.png` | Baum | Stehende Bäume |
| `chain-stem.png` | Rundholz | Polter |
| `chain-lamella.png` | Schnittholz | Gestapelte Lamellen |
| `chain-clt-panel.png` | BSP | Brettsperrholzplatte (ohne den Klebstoffeimer der Originalgrafik) |

PNG mit Transparenz, auf den sichtbaren Inhalt beschnitten. Die Kacheln
zeigen sie mit `object-contain` auf gemeinsamer Grundlinie; unterschiedliche
Seitenverhältnisse sind deshalb unproblematisch.
