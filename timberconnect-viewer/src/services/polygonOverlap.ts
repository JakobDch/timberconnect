/**
 * Überschneidung zweier Pflanzflächen bestimmen.
 *
 * Warum das gebraucht wird: Zwei Pflanzvorgänge dürfen nicht dieselbe Fläche
 * beanspruchen. Täten sie es, ließe sich ein später dort geernteter Stamm über
 * seine GPS-Position zwei verschiedenen Herkünften zuordnen — und beide
 * Zuordnungen sähen im Graph gleich gültig aus. Genau diese
 * Doppelidentifizierung soll die Prüfung verhindern; wer zuerst registriert
 * hat, behält die Fläche.
 *
 * Warum eigener Code statt einer Bibliothek: Es geht um wenige, kleine, einfach
 * geschlossene Ringe. Eine Clipping-Bibliothek (turf/martinez) brächte für
 * diesen einen Zweck einige hundert Kilobyte in ein Bundle, das im Feld über
 * Mobilfunk geladen wird.
 *
 * Verfahren: Weiler-Atherton-artiges Clipping über Schnittpunkt-Verkettung.
 * Sutherland-Hodgman wäre kürzer, setzt aber ein KONVEXES Clip-Polygon voraus —
 * Waldflächen sind fast nie konvex, und der Algorithmus liefert dort still
 * falsche (zu große) Ergebnisse. Das wäre der schlechtere Fehler: eine
 * gemeldete Überschneidung, die es nicht gibt, blockiert einen korrekten
 * Vorgang.
 *
 * Gerechnet wird in Grad (lon/lat) als ebene Koordinaten. Auf der Ausdehnung
 * einer Forstfläche ist die Erdkrümmung für die Frage „überlappen sie sich?"
 * ohne Belang; die Flächengröße des Ergebnisses wird anschließend wieder
 * sphärisch bestimmt (ringAreaHectares).
 */

/** Ein Ring als [lon, lat], offen oder geschlossen. */
export type Ring = number[][];

/**
 * Toleranz in Grad (~1 cm). Trennt echte Überschneidungen von
 * Rundungsrauschen: Zwei Flächen, die sich eine Grenze teilen, berühren sich
 * — sie überlappen nicht. Ohne Toleranz meldete jede gemeinsame Kante einen
 * Konflikt, und aneinandergrenzende Bestände wären nicht mehr erfassbar.
 */
const EPS = 1e-7;

/** Geschlossenen Ring auf die offene Form bringen (letzter Punkt = erster). */
export function openRing(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return Math.abs(fx - lx) < EPS && Math.abs(fy - ly) < EPS
    ? ring.slice(0, -1)
    : ring;
}

/** Doppelte Fläche eines Rings; das Vorzeichen gibt den Umlaufsinn. */
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Ring gegen den Uhrzeigersinn orientieren — Voraussetzung des Clippings. */
function toCounterClockwise(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

/**
 * Punkt-in-Polygon (Ray-Casting).
 *
 * Eigenständig statt `isPointInRing` aus geoService: dort ist die Signatur auf
 * GeoPoint {lat, lon} zugeschnitten, hier wird durchgehend mit [lon, lat]-Paaren
 * gerechnet. Eine Umwandlung pro Test wäre in der inneren Schleife des
 * Clippings unnötiger Aufwand.
 */
function pointInRing(point: number[], ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Liegt der Punkt (nahezu) auf einer Kante des Rings? */
function pointOnEdge(point: number[], ring: Ring): boolean {
  const [x, y] = point;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < 1e-20) continue;
    // Projektion des Punkts auf die Kante, auf 0..1 begrenzt.
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSq));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    if (Math.abs(px - x) < EPS && Math.abs(py - y) < EPS) return true;
  }
  return false;
}

/**
 * Punkt innerhalb ODER auf dem Rand.
 *
 * Nötig für den Enthaltungstest: Zwei deckungsgleiche Flächen haben keine
 * kreuzenden Kanten, und ihre Ecken liegen alle exakt auf dem Rand der
 * anderen. Mit dem reinen Innen-Test würde die vollständigste aller
 * Überschneidungen — dieselbe Fläche zweimal — unerkannt bleiben.
 */
function pointInOrOnRing(point: number[], ring: Ring): boolean {
  return pointInRing(point, ring) || pointOnEdge(point, ring);
}

/**
 * Hat `inner` einen Punkt, der ECHT im Inneren von `outer` liegt?
 *
 * Geprüft werden die Kantenmittelpunkte, nicht die Ecken: Bei
 * deckungsgleichen Flächen liegen alle Ecken auf dem Rand, die Mittelpunkte
 * aber ebenfalls — deshalb zählt hier zusätzlich, ob der Schwerpunkt innen
 * liegt. Das trennt „dieselbe Fläche" von „gemeinsame Kante, sonst getrennt".
 */
function hasInteriorPoint(inner: Ring, outer: Ring): boolean {
  // Schwerpunkt: bei konvexen und den meisten realen Flächen im Inneren.
  const cx = inner.reduce((s, p) => s + p[0], 0) / inner.length;
  const cy = inner.reduce((s, p) => s + p[1], 0) / inner.length;
  if (pointInRing([cx, cy], outer)) return true;

  // Fallback für konkave Ringe, deren Schwerpunkt außerhalb liegen kann.
  for (let i = 0; i < inner.length; i++) {
    const [x1, y1] = inner[i];
    const [x2, y2] = inner[(i + 1) % inner.length];
    if (pointInRing([(x1 + x2) / 2, (y1 + y2) / 2], outer)) return true;
  }
  return false;
}

interface Intersection {
  point: number[];
  /** Lage auf der Kante des Subjekts (0..1) — bestimmt die Reihenfolge. */
  tSubject: number;
  /** Lage auf der Kante des Clips (0..1). */
  tClip: number;
  subjectEdge: number;
  clipEdge: number;
}

/**
 * Schnittpunkt zweier Strecken, sofern sie sich echt kreuzen.
 *
 * Parallele und kollineare Fälle liefern bewusst null: Sie beschreiben
 * gemeinsame Kanten, also Berührung. Die entstehende Fläche ist null, und ein
 * Schnittpunkt dort brächte den Verkettungsschritt nur durcheinander.
 */
function segmentIntersection(
  a1: number[],
  a2: number[],
  b1: number[],
  b2: number[],
): { point: number[]; tA: number; tB: number } | null {
  const dxA = a2[0] - a1[0];
  const dyA = a2[1] - a1[1];
  const dxB = b2[0] - b1[0];
  const dyB = b2[1] - b1[1];

  const denominator = dxA * dyB - dyA * dxB;
  if (Math.abs(denominator) < 1e-14) return null; // parallel/kollinear

  const tA = ((b1[0] - a1[0]) * dyB - (b1[1] - a1[1]) * dxB) / denominator;
  const tB = ((b1[0] - a1[0]) * dyA - (b1[1] - a1[1]) * dxA) / denominator;

  // Endpunkte ausgeschlossen: ein Schnitt exakt in einer Ecke ist eine
  // Beruehrung, keine Durchdringung.
  if (tA <= EPS || tA >= 1 - EPS || tB <= EPS || tB >= 1 - EPS) return null;

  return {
    point: [a1[0] + tA * dxA, a1[1] + tA * dyA],
    tA,
    tB,
  };
}

/** Alle Schnittpunkte zwischen den Kanten zweier Ringe. */
function collectIntersections(subject: Ring, clip: Ring): Intersection[] {
  const out: Intersection[] = [];
  for (let i = 0; i < subject.length; i++) {
    const a1 = subject[i];
    const a2 = subject[(i + 1) % subject.length];
    for (let j = 0; j < clip.length; j++) {
      const b1 = clip[j];
      const b2 = clip[(j + 1) % clip.length];
      const hit = segmentIntersection(a1, a2, b1, b2);
      if (hit) {
        out.push({
          point: hit.point,
          tSubject: hit.tA,
          tClip: hit.tB,
          subjectEdge: i,
          clipEdge: j,
        });
      }
    }
  }
  return out;
}

/** Knoten der verketteten Liste eines Rings (Ecken + Schnittpunkte). */
interface Node {
  point: number[];
  isIntersection: boolean;
  /** Betritt die Kante an diesem Schnittpunkt das andere Polygon? */
  entering: boolean;
  /** Index desselben Schnittpunkts in der Liste des anderen Polygons. */
  partner: number;
  visited: boolean;
}

/**
 * Ring mit eingefügten Schnittpunkten aufbauen.
 *
 * Die Schnittpunkte je Kante werden nach ihrer Lage sortiert eingesetzt, damit
 * die Umlaufreihenfolge erhalten bleibt — sonst entstünden beim Verketten
 * überkreuzte Ergebnisse.
 */
function buildNodes(
  ring: Ring,
  intersections: Intersection[],
  edgeOf: (x: Intersection) => number,
  tOf: (x: Intersection) => number,
  keyOf: (x: Intersection) => number,
): { nodes: Node[]; indexByKey: Map<number, number> } {
  const nodes: Node[] = [];
  const indexByKey = new Map<number, number>();

  for (let i = 0; i < ring.length; i++) {
    nodes.push({
      point: ring[i],
      isIntersection: false,
      entering: false,
      partner: -1,
      visited: false,
    });

    const onEdge = intersections
      .map((x, key) => ({ x, key }))
      .filter(({ x }) => edgeOf(x) === i)
      .sort((a, b) => tOf(a.x) - tOf(b.x));

    for (const { x, key } of onEdge) {
      indexByKey.set(keyOf(x) === -1 ? key : key, nodes.length);
      nodes.push({
        point: x.point,
        isIntersection: true,
        entering: false,
        partner: -1,
        visited: false,
      });
    }
  }
  return { nodes, indexByKey };
}

/**
 * Schnittfläche zweier Ringe.
 *
 * @returns Liste der Überschneidungs-Ringe ([lon, lat], offen). Leer, wenn sich
 *          die Flächen nicht überlappen. Mehrere Ringe sind möglich: zwei
 *          Flächen können sich in getrennten Zipfeln überschneiden.
 */
export function intersectRings(subjectRaw: Ring, clipRaw: Ring): Ring[] {
  const subject = toCounterClockwise(openRing(subjectRaw));
  const clip = toCounterClockwise(openRing(clipRaw));
  if (subject.length < 3 || clip.length < 3) return [];

  const intersections = collectIntersections(subject, clip);

  // Keine echten Kantenschnitte. Drei Faelle sind dann noch moeglich:
  // disjunkt, deckungsgleich, oder eines liegt vollstaendig im anderen.
  //
  // Geprueft wird mit pointInOrOnRing, damit auch geteilte Kanten mitzaehlen
  // (zwei identische Flaechen beruehren sich ueberall). Damit reine
  // Nachbarschaft nicht faelschlich als Enthaltung gilt, muss zusaetzlich
  // mindestens ein Punkt ECHT innen liegen -- oder, bei Deckungsgleichheit,
  // der Mittelpunkt einer Kante.
  if (intersections.length === 0) {
    const subjectInClip = subject.every((p) => pointInOrOnRing(p, clip));
    const clipInSubject = clip.every((p) => pointInOrOnRing(p, subject));

    // Beruehrende Nachbarn erfuellen "alle Punkte auf dem Rand" nicht -- ihre
    // abgewandten Ecken liegen ausserhalb. Bleibt der Fall zweier Flaechen,
    // die sich eine Kante teilen und sonst auseinanderliegen: dort ist keine
    // der beiden Bedingungen erfuellt, und wir landen korrekt bei [].
    if (subjectInClip && hasInteriorPoint(subject, clip)) return [subject];
    if (clipInSubject && hasInteriorPoint(clip, subject)) return [clip];
    return [];
  }

  const subjectList = buildNodes(
    subject,
    intersections,
    (x) => x.subjectEdge,
    (x) => x.tSubject,
    () => -1,
  );
  const clipList = buildNodes(
    clip,
    intersections,
    (x) => x.clipEdge,
    (x) => x.tClip,
    () => -1,
  );

  // Partner verknuepfen: derselbe Schnittpunkt steht in beiden Listen.
  for (let key = 0; key < intersections.length; key++) {
    const si = subjectList.indexByKey.get(key);
    const ci = clipList.indexByKey.get(key);
    if (si === undefined || ci === undefined) continue;
    subjectList.nodes[si].partner = ci;
    clipList.nodes[ci].partner = si;
  }

  // Ein Schnittpunkt betritt das Clip-Polygon, wenn der Mittelpunkt der
  // FOLGENDEN Teilkante darin liegt. Das ist robuster als über Kreuzprodukte
  // zu argumentieren, weil es keine Sonderfälle an Ecken kennt.
  const nodes = subjectList.nodes;
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i].isIntersection) continue;
    const next = nodes[(i + 1) % nodes.length].point;
    const mid = [
      (nodes[i].point[0] + next[0]) / 2,
      (nodes[i].point[1] + next[1]) / 2,
    ];
    nodes[i].entering = pointInRing(mid, clip);
  }

  const results: Ring[] = [];

  for (let start = 0; start < nodes.length; start++) {
    if (!nodes[start].isIntersection || !nodes[start].entering) continue;
    if (nodes[start].visited) continue;

    const ring: Ring = [];
    let onSubject = true;
    let index = start;
    // Obergrenze gegen Endlosläufe bei entarteten Eingaben: Jeder Knoten
    // beider Listen darf höchstens einmal besucht werden.
    const limit = subjectList.nodes.length + clipList.nodes.length + 2;

    for (let step = 0; step < limit; step++) {
      const list = onSubject ? subjectList.nodes : clipList.nodes;
      const node = list[index];

      if (node.isIntersection && node.visited && ring.length > 0) break;
      if (node.isIntersection) {
        node.visited = true;
        const partnerList = onSubject ? clipList.nodes : subjectList.nodes;
        if (node.partner >= 0) partnerList[node.partner].visited = true;
      }

      ring.push(node.point);

      // An einem Schnittpunkt auf das andere Polygon wechseln — so entsteht
      // der Rand der gemeinsamen Fläche.
      if (node.isIntersection && node.partner >= 0 && ring.length > 1) {
        index = node.partner;
        onSubject = !onSubject;
      }

      const currentList = onSubject ? subjectList.nodes : clipList.nodes;
      index = (index + 1) % currentList.length;

      const backAtStart = onSubject && index === start && ring.length > 2;
      if (backAtStart) break;
    }

    if (ring.length >= 3) results.push(ring);
  }

  return results;
}

/** Ein einzelner Überschneidungsbefund. */
export interface OverlapHit {
  /** IRI des Zertifikats, dessen Fläche betroffen ist. */
  certificateIri: string;
  /** Die überschneidenden Teilflächen als Ringe ([lon, lat]). */
  rings: Ring[];
}

/**
 * Eine neu gezeichnete Fläche gegen bestehende prüfen.
 *
 * `minHectares` filtert Streifen weg, die nur durch Rundung entstehen: Zwei
 * Flächen, die an derselben Waldwegkante enden, ergeben rechnerisch oft eine
 * Überschneidung von wenigen Quadratmetern. Die als Konflikt zu melden würde
 * korrekte Eingaben blockieren.
 */
export function findOverlaps(
  candidate: Ring,
  existing: { certificateIri: string; ring: Ring }[],
  areaHectares: (ring: Ring) => number,
  minHectares = 0.01,
): OverlapHit[] {
  const hits: OverlapHit[] = [];
  for (const area of existing) {
    const rings = intersectRings(candidate, area.ring).filter(
      (ring) => areaHectares(ring) >= minHectares,
    );
    if (rings.length > 0) {
      hits.push({ certificateIri: area.certificateIri, rings });
    }
  }
  return hits;
}
