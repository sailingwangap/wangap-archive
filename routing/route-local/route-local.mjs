#!/usr/bin/env node
// ⚠️⚠️ FICHIER GÉNÉRÉ — scripts/routing/build-route-local-bundle.mjs (sources 46a4abeee310ebf0, 63 fichiers).
// Le routeur de Wang'ap pour le PC du bord : node route-local.mjs --help.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { Worker as Worker$1, isMainThread, parentPort, workerData } from "node:worker_threads";
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
//#region scripts/routing/lib/geo.mjs
var R_NM = 3440.065;
var rad = Math.PI / 180;
function distNm(a, b) {
	const dLat = (b.lat - a.lat) * rad;
	const dLon = (b.lon - a.lon) * rad;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b) {
	const la1 = a.lat * rad;
	const la2 = b.lat * rad;
	const dlo = (b.lon - a.lon) * rad;
	const y = Math.sin(dlo) * Math.cos(la2);
	const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo);
	return (Math.atan2(y, x) / rad + 360) % 360;
}
/** Le point atteint depuis `a` en suivant `brg` sur `nm` milles (orthodromie). */
function destination(a, brg, nm) {
	const d = nm / R_NM;
	const t = brg * rad;
	const la1 = a.lat * rad;
	const lo1 = a.lon * rad;
	const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(t));
	const lo2 = lo1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
	return {
		lat: la2 / rad,
		lon: (lo2 / rad + 540) % 360 - 180
	};
}
/** L'angle du vent réel vu du bateau (TWA absolu), 0–180°. */
function twaAbs(heading, windFrom) {
	return Math.abs(((windFrom - heading) % 360 + 540) % 360 - 180);
}
/**
* Le masque de terre : une grille de booléens sur une emprise, remplie par
* balayage de lignes (scanline) depuis des polygones GeoJSON — une fois, puis
* chaque test coûte une lecture de tableau.
* → { isLand(lat, lon), segmentHitsLand(a, b, stepNm) }
*/
function buildLandMask(features, bbox, cellDeg = .02) {
	const [w, s, e, n] = bbox;
	const cols = Math.ceil((e - w) / cellDeg);
	const rows = Math.ceil((n - s) / cellDeg);
	const grid = new Uint8Array(cols * rows);
	const edges = [];
	for (const f of features) {
		const g = f.geometry;
		if (!g) continue;
		const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
		for (const poly of polys) for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i];
			const [xj, yj] = ring[j];
			if (yi === yj) continue;
			const ymin = Math.min(yi, yj);
			const ymax = Math.max(yi, yj);
			if (ymax < s || ymin > n || Math.min(xi, xj) > e) continue;
			edges.push({
				ymin,
				ymax,
				x0: yi < yj ? xi : xj,
				y0: ymin,
				k: (xj - xi) / (yj - yi)
			});
		}
	}
	edges.sort((a, b) => a.ymin - b.ymin);
	let active = [];
	let next = 0;
	for (let r = 0; r < rows; r++) {
		const y = s + (r + .5) * cellDeg;
		while (next < edges.length && edges[next].ymin <= y) active.push(edges[next++]);
		active = active.filter((ed) => ed.ymax > y);
		const xs = active.map((ed) => ed.x0 + (y - ed.y0) * ed.k);
		xs.sort((a, b) => a - b);
		if (xs.length % 2) xs.push(Infinity);
		for (let k = 0; k + 1 < xs.length; k += 2) {
			const c0 = Math.max(0, Math.ceil((xs[k] - w) / cellDeg - .5));
			const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - w) / cellDeg - .5));
			for (let c = c0; c <= c1; c++) grid[r * cols + c] = 1;
		}
	}
	return maskFromGrid({
		grid,
		cols,
		rows,
		bbox,
		cellDeg
	});
}
/**
* Le masque à partir de sa grille — pour le passer à un fil de calcul
* (worker_threads) sans refaire le balayage.
* → { isLand, segmentHitsLand, cols, rows, data }
*/
function maskFromGrid(data) {
	const { grid, cols, rows, bbox, cellDeg } = data;
	const [w, s] = bbox;
	const isLand = (lat, lon) => {
		const c = Math.floor((lon - w) / cellDeg);
		const r = Math.floor((lat - s) / cellDeg);
		if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
		return grid[r * cols + c] === 1;
	};
	const segmentHitsLand = (a, b, stepNm = 1) => {
		const d = distNm(a, b);
		const n2 = Math.max(1, Math.ceil(d / stepNm));
		for (let i = 1; i <= n2; i++) {
			const t = i / n2;
			if (isLand(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)) return true;
		}
		return false;
	};
	return {
		isLand,
		segmentHitsLand,
		cols,
		rows,
		data
	};
}
/**
* La MARGE À LA CÔTE (24 oct.) : le masque élargi de `nm` milles — toute
* cellule à moins de `nm` d'une terre devient « terre ». Un voilier de
* croisière ne rase pas la côte (filets, cailloux, houle qui lève, pas de
* place pour réagir de nuit). On ne dilate qu'à partir des cellules de côte.
*/
function dilateMask(mask, marginNm) {
	let nm = marginNm;
	const { grid, cols, rows, bbox, cellDeg } = mask.data;
	const out = new Uint8Array(grid);
	const cellNmLat = cellDeg * 60;
	const midLat = (bbox[1] + bbox[3]) / 2 * Math.PI / 180;
	const cellNmLon = cellDeg * 60 * Math.cos(midLat);
	nm += cellNmLat / 2;
	const rr = Math.ceil(nm / cellNmLat);
	const rc = Math.ceil(nm / cellNmLon);
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
		if (grid[r * cols + c] !== 1) continue;
		let coast = false;
		for (let dr = -1; dr <= 1 && !coast; dr++) for (let dc = -1; dc <= 1; dc++) {
			const r2 = r + dr;
			const c2 = c + dc;
			if (r2 >= 0 && c2 >= 0 && r2 < rows && c2 < cols && grid[r2 * cols + c2] === 0) {
				coast = true;
				break;
			}
		}
		if (!coast) continue;
		for (let dr = -rr; dr <= rr; dr++) for (let dc = -rc; dc <= rc; dc++) {
			const r2 = r + dr;
			const c2 = c + dc;
			if (r2 < 0 || c2 < 0 || r2 >= rows || c2 >= cols) continue;
			if ((dr * cellNmLat) ** 2 + (dc * cellNmLon) ** 2 <= nm * nm) out[r2 * cols + c2] = 1;
		}
	}
	return maskFromGrid({
		grid: out,
		cols,
		rows,
		bbox,
		cellDeg
	});
}
/** Un point dans un polygone simple [[lon, lat], …] (zones interdites : DST). */
function inPolygon(lat, lon, ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > lat !== yj > lat && lon < xi + (lat - yi) / (yj - yi) * (xj - xi)) inside = !inside;
	}
	return inside;
}
/**
* Le point en mer le plus proche (pur) : un port ou une ville sont « à terre »
* pour une côte au 1:10 M. On cherche, en anneaux autour du point, la cellule
* de mer la plus proche dont les 8 voisines sont aussi en mer (pas une
* crique), dans `maxNm`. → { lat, lon, movedNm } ou null.
*/
function snapToSea(land, p, { maxNm = 15, cellDeg = land.data?.cellDeg ?? .02 } = {}) {
	const open = (lat, lon) => {
		for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (land.isLand(lat + di * cellDeg, lon + dj * cellDeg)) return false;
		return true;
	};
	if (open(p.lat, p.lon)) return {
		lat: p.lat,
		lon: p.lon,
		movedNm: 0
	};
	const maxK = Math.ceil(maxNm / (cellDeg * 60 * Math.cos(p.lat * Math.PI / 180))) + 1;
	let best = null;
	for (let k = 1; k <= maxK; k++) {
		for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) {
			if (Math.max(Math.abs(i), Math.abs(j)) !== k) continue;
			const q = {
				lat: p.lat + i * cellDeg,
				lon: p.lon + j * cellDeg
			};
			if (!open(q.lat, q.lon)) continue;
			const d = distNm(p, q);
			if (d <= maxNm && (!best || d < best.movedNm)) best = {
				...q,
				movedNm: d
			};
		}
		if (best && k * cellDeg * 60 * Math.cos(p.lat * Math.PI / 180) > best.movedNm * 1.5) break;
	}
	return best;
}
//#endregion
//#region scripts/routing/lib/coastIndex.mjs
/**
* features : polygones GeoJSON (lon, lat) ; bbox : [O, S, E, N].
* → { crosses(a, b), data } — `data` passe tel quel à un fil de calcul
*   (indexFromData), sans reconstruire.
*/
function buildCoastIndex(features, bbox, cellDeg = .05) {
	return indexFromEdges(coastEdges(features, bbox, cellDeg), bbox, cellDeg);
}
/**
* ROUTE-028 (D29) — les ARÊTES du trait de côte qui touchent l'emprise
* (± `pad` degrés), à la suite : x1, y1, x2, y2… (pur). Séparé de l'index pour
* que le navigateur (src/lib/localRouting) reconstruise le MÊME index à partir
* d'arêtes précalculées par tuiles, sans les polygones entiers.
*/
function coastEdges(features, bbox, pad = .05) {
	const [w, s, e, n] = bbox;
	const xs = [];
	for (const f of features) {
		const g = f.geometry;
		if (!g) continue;
		const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
		for (const poly of polys) for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [x1, y1] = ring[j];
			const [x2, y2] = ring[i];
			if (Math.max(x1, x2) < w - pad || Math.min(x1, x2) > e + pad || Math.max(y1, y2) < s - pad || Math.min(y1, y2) > n + pad) continue;
			xs.push(x1, y1, x2, y2);
		}
	}
	return xs;
}
/** L'index (par cellules de `cellDeg`) d'une liste d'arêtes x1, y1, x2, y2… déjà retenues pour l'emprise (pur). */
function indexFromEdges(xs, bbox, cellDeg = .05) {
	const [w, s, e, n] = bbox;
	const cols = Math.ceil((e - w) / cellDeg);
	const rows = Math.ceil((n - s) / cellDeg);
	const buckets = Array.from({ length: cols * rows }, () => []);
	for (let id = 0; id < xs.length / 4; id++) {
		const x1 = xs[4 * id];
		const y1 = xs[4 * id + 1];
		const x2 = xs[4 * id + 2];
		const y2 = xs[4 * id + 3];
		const c0 = Math.max(0, Math.floor((Math.min(x1, x2) - w) / cellDeg));
		const c1 = Math.min(cols - 1, Math.floor((Math.max(x1, x2) - w) / cellDeg));
		const r0 = Math.max(0, Math.floor((Math.min(y1, y2) - s) / cellDeg));
		const r1 = Math.min(rows - 1, Math.floor((Math.max(y1, y2) - s) / cellDeg));
		for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) buckets[r * cols + c].push(id);
	}
	const start = new Int32Array(cols * rows + 1);
	let total = 0;
	for (let k = 0; k < buckets.length; k++) {
		start[k] = total;
		total += buckets[k].length;
	}
	start[buckets.length] = total;
	const ids = new Int32Array(total);
	let p = 0;
	for (const b of buckets) for (const id of b) ids[p++] = id;
	return indexFromData({
		edges: Float64Array.from(xs),
		start,
		ids,
		cols,
		rows,
		bbox,
		cellDeg
	});
}
var orient$1 = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
/** L'index à partir de ses tableaux (dans un fil de calcul). */
function indexFromData(data) {
	const { edges, start, ids, cols, rows, bbox, cellDeg } = data;
	const [w, s] = bbox;
	const seen = new Uint8Array(edges.length / 4);
	const touched = [];
	/** Le segment a → b ({lat, lon}) croise-t-il le trait de côte ? (contact compris) */
	function crosses(a, b) {
		const ax = a.lon;
		const ay = a.lat;
		const bx = b.lon;
		const by = b.lat;
		const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - w) / cellDeg));
		const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) - w) / cellDeg));
		const r0 = Math.max(0, Math.floor((Math.min(ay, by) - s) / cellDeg));
		const r1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) - s) / cellDeg));
		let hit = false;
		for (let r = r0; r <= r1 && !hit; r++) for (let c = c0; c <= c1 && !hit; c++) {
			const k = r * cols + c;
			for (let q = start[k]; q < start[k + 1]; q++) {
				const id = ids[q];
				if (seen[id]) continue;
				seen[id] = 1;
				touched.push(id);
				const ex1 = edges[4 * id];
				const ey1 = edges[4 * id + 1];
				const ex2 = edges[4 * id + 2];
				const ey2 = edges[4 * id + 3];
				const d1 = orient$1(ax, ay, bx, by, ex1, ey1);
				const d2 = orient$1(ax, ay, bx, by, ex2, ey2);
				const d3 = orient$1(ex1, ey1, ex2, ey2, ax, ay);
				const d4 = orient$1(ex1, ey1, ex2, ey2, bx, by);
				if ((d1 <= 0 && d2 >= 0 || d1 >= 0 && d2 <= 0) && (d3 <= 0 && d4 >= 0 || d3 >= 0 && d4 <= 0)) {
					if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0 && (Math.max(ax, bx) < Math.min(ex1, ex2) || Math.max(ex1, ex2) < Math.min(ax, bx) || Math.max(ay, by) < Math.min(ey1, ey2) || Math.max(ey1, ey2) < Math.min(ay, by))) continue;
					hit = true;
					break;
				}
			}
		}
		for (const id of touched) seen[id] = 0;
		touched.length = 0;
		return hit;
	}
	/**
	* Le segment passe-t-il à moins de `nm` milles du trait de côte ? (le
	* DÉGAGEMENT minimal, partout — Flavien : la route frôlait le feu de Tarifa).
	* Distance segment–segment dans un plan local (longitudes × cos lat).
	*/
	function near(a, b, nm) {
		if (crosses(a, b)) return true;
		const k = Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
		const dDeg = nm / 60;
		const ax = a.lon * k;
		const ay = a.lat;
		const bx = b.lon * k;
		const by = b.lat;
		const c0 = Math.max(0, Math.floor((Math.min(a.lon, b.lon) - dDeg / k - w) / cellDeg));
		const c1 = Math.min(cols - 1, Math.floor((Math.max(a.lon, b.lon) + dDeg / k - w) / cellDeg));
		const r0 = Math.max(0, Math.floor((Math.min(a.lat, b.lat) - dDeg - s) / cellDeg));
		const r1 = Math.min(rows - 1, Math.floor((Math.max(a.lat, b.lat) + dDeg - s) / cellDeg));
		const d2 = dDeg * dDeg;
		let hit = false;
		const ptSeg = (px, py, x1, y1, x2, y2) => {
			const dx = x2 - x1;
			const dy = y2 - y1;
			const L = dx * dx + dy * dy;
			const t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
			const qx = x1 + t * dx - px;
			const qy = y1 + t * dy - py;
			return qx * qx + qy * qy;
		};
		for (let r = r0; r <= r1 && !hit; r++) for (let c = c0; c <= c1 && !hit; c++) {
			const cell = r * cols + c;
			for (let q = start[cell]; q < start[cell + 1]; q++) {
				const id = ids[q];
				if (seen[id]) continue;
				seen[id] = 1;
				touched.push(id);
				const ex1 = edges[4 * id] * k;
				const ey1 = edges[4 * id + 1];
				const ex2 = edges[4 * id + 2] * k;
				const ey2 = edges[4 * id + 3];
				if (ptSeg(ax, ay, ex1, ey1, ex2, ey2) < d2 || ptSeg(bx, by, ex1, ey1, ex2, ey2) < d2 || ptSeg(ex1, ey1, ax, ay, bx, by) < d2 || ptSeg(ex2, ey2, ax, ay, bx, by) < d2) {
					hit = true;
					break;
				}
			}
		}
		for (const id of touched) seen[id] = 0;
		touched.length = 0;
		return hit;
	}
	/** Une ligne [{lat, lon}…] : l'indice du premier segment qui croise la côte, ou -1. */
	function firstCrossing(points) {
		for (let i = 1; i < points.length; i++) if (crosses(points[i - 1], points[i])) return i;
		return -1;
	}
	return {
		crosses,
		near,
		firstCrossing,
		data,
		edgeCount: edges.length / 4
	};
}
//#endregion
//#region scripts/routing/lib/shapefile.mjs
var R = 6378137;
var toLon = (x) => x / R * (180 / Math.PI);
var toLat = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
var toX = (lon) => lon * Math.PI / 180 * R;
var toY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 180 / 2));
/**
* Les polygones (type 5) qui touchent l'emprise [ouest, sud, est, nord] en
* degrés, convertis en lon/lat → [{ geometry: { type: 'Polygon', coordinates: [anneau…] } }].
* `mercator` : false si le fichier est déjà en degrés (EPSG:4326).
*/
function readShpPolygons(buf, bbox, { mercator = true } = {}) {
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const [w, s, e, n] = mercator ? [
		toX(bbox[0]),
		toY(bbox[1]),
		toX(bbox[2]),
		toY(bbox[3])
	] : bbox;
	const conv = mercator ? (x, y) => [toLon(x), toLat(y)] : (x, y) => [x, y];
	const out = [];
	let off = 100;
	while (off + 8 <= buf.byteLength) {
		const len = dv.getInt32(off + 4, false) * 2;
		const c = off + 8;
		off = c + len;
		if (dv.getInt32(c, true) !== 5) continue;
		const xmin = dv.getFloat64(c + 4, true);
		const ymin = dv.getFloat64(c + 12, true);
		const xmax = dv.getFloat64(c + 20, true);
		const ymax = dv.getFloat64(c + 28, true);
		if (xmax < w || xmin > e || ymax < s || ymin > n) continue;
		const nParts = dv.getInt32(c + 36, true);
		const nPoints = dv.getInt32(c + 40, true);
		const parts = [];
		for (let i = 0; i < nParts; i++) parts.push(dv.getInt32(c + 44 + 4 * i, true));
		const pts = c + 44 + 4 * nParts;
		const rings = [];
		for (let p = 0; p < nParts; p++) {
			const from = parts[p];
			const to = p + 1 < nParts ? parts[p + 1] : nPoints;
			const ring = new Array(to - from);
			for (let k = from; k < to; k++) ring[k - from] = conv(dv.getFloat64(pts + 16 * k, true), dv.getFloat64(pts + 16 * k + 8, true));
			rings.push(ring);
		}
		out.push({ geometry: {
			type: "Polygon",
			coordinates: rings
		} });
	}
	return out;
}
//#endregion
//#region scripts/routing/lib/context.mjs
var PLACES = {
	gibraltar: {
		lat: 36.12,
		lon: -5.37,
		name: "Gibraltar"
	},
	laspalmas: {
		lat: 28.14,
		lon: -15.4,
		name: "Las Palmas (Gran Canaria)"
	},
	lanzarote: {
		lat: 28.95,
		lon: -13.52,
		name: "Arrecife (Lanzarote)"
	},
	tenerife: {
		lat: 28.47,
		lon: -16.23,
		name: "Santa Cruz (Tenerife)"
	}
};
var TSS_GIBRALTAR = [
	[-5.75, 35.87],
	[-5.42, 35.87],
	[-5.42, 35.975],
	[-5.75, 35.975],
	[-5.75, 35.87]
];
var photon = async (q, extra = "") => {
	const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5${extra}`, { signal: AbortSignal.timeout(15e3) });
	if (!r.ok) throw new Error(`Photon ${r.status}`);
	return (await r.json()).features || [];
};
var fromFeature = (f, kind) => ({
	lat: f.geometry.coordinates[1],
	lon: f.geometry.coordinates[0],
	kind,
	name: [
		f.properties.name,
		f.properties.city !== f.properties.name ? f.properties.city : null,
		f.properties.country
	].filter(Boolean).join(", ")
});
/** La dernière position connue du bateau (LECTURE SEULE en production). */
async function boatPosition() {
	const { createClient } = createRequire(import.meta.url)("@supabase/supabase-js");
	try {
		for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
			if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
		}
	} catch {}
	const { data, error } = await createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).from("waypoints").select("recorded_at, latitude, longitude").is("superseded_by", null).order("recorded_at", { ascending: false }).limit(1);
	if (error || !data?.length) throw new Error(`position du bateau : ${error?.message || "aucune"}`);
	return {
		lat: data[0].latitude,
		lon: data[0].longitude,
		at: data[0].recorded_at,
		kind: "bateau",
		name: `Wang'ap (${data[0].recorded_at.slice(0, 16).replace("T", " ")}Z)`
	};
}
/**
* Un lieu tel qu'on le tape : « laspalmas », « 28.1,-15.4 », « bateau », ou un
* nom (« Las Palmas », « Marina Lanzarote », « Mindelo »). Pour un nom : le lieu
* chez Photon, puis la marina la plus proche dans 25 milles (on vise le port,
* pas le centre-ville) — sinon le lieu lui-même.
*/
async function resolvePlace(text) {
	const v = String(text).trim();
	const key = v.toLowerCase().replace(/[^a-z]/g, "");
	if (PLACES[key]) return {
		...PLACES[key],
		kind: "connu"
	};
	const ll = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
	if (ll) return {
		lat: Number(ll[1]),
		lon: Number(ll[2]),
		name: `${Number(ll[1]).toFixed(2)}, ${Number(ll[2]).toFixed(2)}`,
		kind: "coordonnées"
	};
	if (key === "bateau" || key === "boat") return boatPosition();
	const any = await photon(v);
	if (!any.length) throw new Error(`lieu introuvable : « ${v} »`);
	const place = fromFeature(any[0], "lieu");
	return (await photon(v, `&osm_tag=leisure:marina&lat=${place.lat}&lon=${place.lon}`)).map((f) => fromFeature(f, "marina")).find((m) => distNm(m, place) <= 25) || place;
}
/** La côte Natural Earth 1:10 M (téléchargée une fois, puis en cache). */
async function loadLandFeatures(cacheDir, log = () => {}) {
	const landFile = path.join(cacheDir, "ne_10m_land.geojson");
	if (!fs.existsSync(landFile)) {
		log("Côte : téléchargement de Natural Earth (une fois)…");
		const r = await fetch("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson");
		if (!r.ok) throw new Error(`Natural Earth ${r.status}`);
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.writeFileSync(landFile, Buffer.from(await r.arrayBuffer()));
	}
	return JSON.parse(fs.readFileSync(landFile, "utf8")).features;
}
/** L'emprise d'un passage : les deux bouts et une marge pour les détours. */
var passageBbox = (a, b) => [
	Math.floor(Math.min(a.lon, b.lon) - 2),
	Math.floor(Math.min(a.lat, b.lat) - 1.5),
	Math.ceil(Math.max(a.lon, b.lon) + 1.5),
	Math.ceil(Math.max(a.lat, b.lat) + 1.5)
];
var GIB_E = {
	name: "Détroit de Gibraltar (entrée est)",
	lat: 36.06,
	lon: -5.29,
	strait: "gibraltar"
};
var GIB_W = {
	name: "Détroit de Gibraltar (sortie ouest)",
	lat: 35.95,
	lon: -5.85,
	strait: "gibraltar"
};
var med = (p) => p.lon > -5.3 && p.lat > 34.5 && p.lat < 44;
var atl = (p) => p.lon < -5.6;
var nearGib = (p) => distNm(p, {
	lat: 36,
	lon: -5.55
}) < 25;
/** Le détroit où se trouve un point (un départ DE Gibraltar) — sa jambe vers la porte voisine se fait sans marge. */
var straitOf = (p) => nearGib(p) ? "gibraltar" : null;
/** Les portes entre deux bouts, DANS L'ORDRE du passage. */
function gatesBetween(a, b) {
	if (med(a) && atl(b)) return nearGib(b) ? [GIB_E] : [GIB_E, GIB_W];
	if (atl(a) && med(b)) return nearGib(a) ? [GIB_E] : [GIB_W, GIB_E];
	if (nearGib(a) && atl(b) && !nearGib(b)) return [GIB_W];
	if (atl(a) && !nearGib(a) && nearGib(b)) return [GIB_W];
	return [];
}
//#endregion
//#region scripts/routing/lib/charts.mjs
var UA = { "User-Agent": "Wangap-routing-prototype/0.1" };
var DAY = 864e5;
var fresh = (f, maxAgeMs) => fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < maxAgeMs;
var key = (bbox) => bbox.join("_");
var OSM_LAND_URL = "https://osmdata.openstreetmap.de/download/simplified-land-polygons-complete-3857.zip";
async function osmLandShp(cacheDir, log) {
	const dir = path.join(cacheDir, "osm-land");
	const shp = path.join(dir, "simplified-land-polygons-complete-3857", "simplified_land_polygons.shp");
	if (fresh(shp, 90 * DAY)) return shp;
	log("Côte : téléchargement des polygones de terre OpenStreetMap (≈ 24 Mo, une fois par trimestre)…");
	const r = await fetch(OSM_LAND_URL, { headers: UA });
	if (!r.ok) throw new Error(`osmdata ${r.status}`);
	fs.mkdirSync(dir, { recursive: true });
	const zip = path.join(dir, "land.zip");
	fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
	execFileSync("unzip", [
		"-o",
		"-q",
		zip,
		"-d",
		dir
	]);
	fs.rmSync(zip);
	return shp;
}
/**
* Le masque de terre de l'emprise, à `cellDeg`, en cache.
* → { mask, source: 'OpenStreetMap' | 'Natural Earth' }
*/
async function loadCoastMask(bbox, { cacheDir, cellDeg = .01, log = () => {} }) {
	const file = path.join(cacheDir, `mask-osm-${key(bbox)}-${cellDeg}.bin`);
	const [w, s, e, n] = bbox;
	const cols = Math.ceil((e - w) / cellDeg);
	const rows = Math.ceil((n - s) / cellDeg);
	if (fresh(file, 90 * DAY)) return {
		mask: maskFromGrid({
			grid: new Uint8Array(fs.readFileSync(file)),
			cols,
			rows,
			bbox,
			cellDeg
		}),
		source: "OpenStreetMap"
	};
	try {
		const shp = await osmLandShp(cacheDir, log);
		const mask = buildLandMask(readShpPolygons(fs.readFileSync(shp), [
			w - .5,
			s - .5,
			e + .5,
			n + .5
		]), bbox, cellDeg);
		fs.writeFileSync(file, mask.data.grid);
		return {
			mask,
			source: "OpenStreetMap"
		};
	} catch (err) {
		log(`⚠️ côte OpenStreetMap indisponible (${err.message}) — repli sur Natural Earth`);
		return {
			mask: buildLandMask(await loadLandFeatures(cacheDir, log), bbox, cellDeg),
			source: "Natural Earth"
		};
	}
}
var ETOPO = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.esriAscii";
/** Une grille ESRI ASCII → { ncols, nrows, xll, yll, cell, z (Float32Array, rangée 0 = NORD) }. */
function parseEsriAscii(text) {
	const head = {};
	let i = 0;
	const lines = text.split("\n");
	for (; i < lines.length; i++) {
		const m = lines[i].match(/^\s*([a-zA-Z_]+)\s+(-?[\d.eE+-]+)\s*$/);
		if (!m) break;
		head[m[1].toLowerCase()] = Number(m[2]);
	}
	const ncols = head.ncols;
	const nrows = head.nrows;
	const z = new Float32Array(ncols * nrows);
	let k = 0;
	for (; i < lines.length && k < z.length; i++) for (const v of lines[i].trim().split(/\s+/)) if (v !== "") z[k++] = Number(v);
	return {
		ncols,
		nrows,
		xll: head.xllcenter ?? head.xllcorner,
		yll: head.yllcenter ?? head.yllcorner,
		cell: head.cellsize,
		nodata: head.nodata_value,
		z
	};
}
/**
* Les petits fonds (< `minDepth` m) sur la grille du masque : 1 = trop peu
* d'eau (hors terre). → { grid: Uint8Array, source } ou null (indisponible).
*/
async function loadShallowGrid(bbox, { cacheDir, cellDeg = .01, minDepth = 20, log = () => {} }) {
	const [w, s, e, n] = bbox;
	const file = path.join(cacheDir, `etopo-${key(bbox)}.asc`);
	try {
		if (!fresh(file, 365 * DAY)) {
			log("Fonds : téléchargement d'ETOPO 2022 pour la zone (une fois)…");
			const url = `${ETOPO}?z%5B(${s}):3:(${n})%5D%5B(${w}):3:(${e})%5D`;
			const r = await fetch(url, {
				headers: UA,
				signal: AbortSignal.timeout(18e4)
			});
			if (!r.ok) throw new Error(`ERDDAP ${r.status}`);
			fs.writeFileSync(file, await r.text());
		}
		const g = parseEsriAscii(fs.readFileSync(file, "utf8"));
		const cols = Math.ceil((e - w) / cellDeg);
		const rows = Math.ceil((n - s) / cellDeg);
		const grid = new Uint8Array(cols * rows);
		for (let r2 = 0; r2 < rows; r2++) {
			const lat = s + (r2 + .5) * cellDeg;
			const gi = g.nrows - 1 - Math.round((lat - g.yll) / g.cell);
			if (gi < 0 || gi >= g.nrows) continue;
			for (let c = 0; c < cols; c++) {
				const lon = w + (c + .5) * cellDeg;
				const gj = Math.round((lon - g.xll) / g.cell);
				if (gj < 0 || gj >= g.ncols) continue;
				const z = g.z[gi * g.ncols + gj];
				if (z > -minDepth && z < 0) grid[r2 * cols + c] = 1;
			}
		}
		return {
			grid,
			source: "ETOPO 2022 (GEBCO)"
		};
	} catch (err) {
		log(`⚠️ profondeurs indisponibles (${err.message}) — pas de garde des petits fonds`);
		return null;
	}
}
var close = (ring) => ring.length && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) ? [...ring, ring[0]] : ring;
var inRing = (pt, ring) => {
	let c = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > pt[1] !== yj > pt[1] && pt[0] < xi + (pt[1] - yi) / (yj - yi) * (xj - xi)) c = !c;
	}
	return c;
};
/** Une bande de ± `nm` milles autour d'une ligne [[lon, lat], …] (normales moyennées aux sommets). */
function bufferLine(line, nm) {
	const k = Math.cos(line[0][1] * Math.PI / 180);
	const d = nm / 60;
	const normals = line.map((_, i) => {
		const a = line[Math.max(0, i - 1)];
		const b = line[Math.min(line.length - 1, i + 1)];
		const dx = (b[0] - a[0]) * k;
		const dy = b[1] - a[1];
		const len = Math.hypot(dx, dy) || 1;
		return [-dy / len, dx / len];
	});
	const left = line.map(([x, y], i) => [x + normals[i][0] * d / k, y + normals[i][1] * d]);
	const right = line.map(([x, y], i) => [x - normals[i][0] * d / k, y - normals[i][1] * d]).reverse();
	return close([...left, ...right]);
}
/**
* Les zones interdites à partir des éléments OSM `seamark:type=separation_*`
* (pur) :
*  1. les zones de séparation et les limites FERMÉES sont des polygones ;
*  2. les limites et lignes OUVERTES vont par paires — deux lignes à peu près
*     parallèles, qui se recouvrent le long de leur direction et sont écartées
*     l'une de l'autre (quelle que soit l'orientation : Gibraltar court
*     est-ouest, les dispositifs des Canaries nord-est – sud-ouest) ; leur
*     entre-deux est interdit (les deux voies et ce qui les sépare) ;
*  3. une voie de circulation qui n'est dans aucun de ces polygones (une
*     limite extérieure manque dans OSM — Gran Canaria – Tenerife, São
*     Vicente) : une bande de ± 1 mille le long de la voie.
* → anneaux [[lon, lat], …]
*/
function tssPolygonsFromOsm(elements) {
	const items = [];
	for (const el of elements) {
		const t = el.tags?.["seamark:type"];
		const g = (el.geometry || []).map((p) => [p.lon, p.lat]);
		if (g.length >= 2 && t) items.push({
			t,
			g,
			closed: g.length > 3 && g[0][0] === g.at(-1)[0] && g[0][1] === g.at(-1)[1]
		});
	}
	const rings = [];
	for (const it of items) if (it.closed && /^separation_(zone|boundary|roundabout)$/.test(it.t)) rings.push(it.g);
	const open = items.filter((it) => !it.closed && (it.t === "separation_boundary" || it.t === "separation_line")).map((it) => it.g);
	const geom = (l) => {
		const a = l[0];
		const b = l.at(-1);
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		return {
			a,
			ux: (b[0] - a[0]) / len,
			uy: (b[1] - a[1]) / len,
			len
		};
	};
	const used = /* @__PURE__ */ new Set();
	for (let i = 0; i < open.length; i++) {
		if (used.has(i)) continue;
		const A = geom(open[i]);
		let best = -1;
		let bestOv = 0;
		for (let j = 0; j < open.length; j++) {
			if (j === i || used.has(j)) continue;
			const B = geom(open[j]);
			if (Math.abs(A.ux * B.ux + A.uy * B.uy) < .94) continue;
			const along = open[j].map(([x, y]) => (x - A.a[0]) * A.ux + (y - A.a[1]) * A.uy);
			const across = open[j].map(([x, y]) => (x - A.a[0]) * -A.uy + (y - A.a[1]) * A.ux);
			const ov = Math.min(A.len, Math.max(...along)) - Math.max(0, Math.min(...along));
			const gap = Math.abs(across.reduce((u, v) => u + v, 0) / across.length);
			if (ov > .5 * Math.min(A.len, B.len) && gap > .01 && gap < .3 && ov > bestOv) {
				best = j;
				bestOv = ov;
			}
		}
		if (best < 0) continue;
		used.add(i);
		used.add(best);
		const a = open[i];
		let b = open[best];
		const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
		b = d(a.at(-1), b[0]) < d(a.at(-1), b.at(-1)) ? b.slice() : b.slice().reverse();
		rings.push(close([...a, ...b]));
	}
	for (const it of items) {
		if (it.t !== "separation_lane") continue;
		const l = it.g;
		const mid = [(l[0][0] + l.at(-1)[0]) / 2, (l[0][1] + l.at(-1)[1]) / 2];
		if (rings.some((r) => inRing(mid, r))) continue;
		rings.push(bufferLine(l, 1.2));
	}
	return rings;
}
/** Les zones interdites de l'emprise (Overpass, en cache 30 jours). → { rings, source } */
async function loadTss(bbox, { cacheDir, log = () => {} }) {
	const file = path.join(cacheDir, `tss-${key(bbox)}.json`);
	try {
		if (!fresh(file, 30 * DAY)) {
			const [w, s, e, n] = bbox;
			const q = `[out:json][timeout:60];(way["seamark:type"~"^separation_"](${s},${w},${n},${e}););out tags geom;`;
			const r = await fetch("https://overpass-api.de/api/interpreter", {
				method: "POST",
				headers: {
					...UA,
					"Content-Type": "application/x-www-form-urlencoded"
				},
				body: `data=${encodeURIComponent(q)}`,
				signal: AbortSignal.timeout(9e4)
			});
			if (!r.ok) throw new Error(`Overpass ${r.status}`);
			fs.writeFileSync(file, await r.text());
		}
		const rings = tssPolygonsFromOsm(JSON.parse(fs.readFileSync(file, "utf8")).elements || []);
		if (!rings.length) return {
			rings: [],
			source: "OpenSeaMap (aucun dispositif dans la zone)"
		};
		return {
			rings,
			source: `OpenSeaMap (${rings.length} zones)`
		};
	} catch (err) {
		log(`⚠️ dispositifs OpenSeaMap indisponibles (${err.message}) — repli sur le rectangle approximatif de Gibraltar`);
		return {
			rings: [TSS_GIBRALTAR],
			source: "rectangle approximatif"
		};
	}
}
/**
* Les polygones de terre de l'emprise (OSM, sinon Natural Earth) — pour la
* CÔTE EXACTE (coastIndex.mjs) : le masque échantillonne, l'index tranche.
*/
async function loadCoastFeatures(bbox, { cacheDir, log = () => {} }) {
	const [w, s, e, n] = bbox;
	try {
		const shp = await osmLandShp(cacheDir, log);
		return {
			features: readShpPolygons(fs.readFileSync(shp), [
				w - .5,
				s - .5,
				e + .5,
				n + .5
			]),
			source: "OpenStreetMap"
		};
	} catch {
		return {
			features: await loadLandFeatures(cacheDir, log),
			source: "Natural Earth"
		};
	}
}
/**
* ROUTE-028 (ADR-0039 D29) — D'OÙ VIENNENT les morceaux des cartes. Node : le
* cache disque et le réseau (ci-dessus). Le navigateur et le PC du bord
* (src/lib/localRouting/chartTiles.js) passent les leurs — des tuiles
* précalculées à partir des MÊMES sources —, et la composition ci-dessous
* reste la seule : une seule façon d'assembler la terre, la marge, les fonds,
* les dispositifs et la côte exacte.
*/
var NODE_CHART_SOURCES = {
	coastMask: loadCoastMask,
	shallowGrid: loadShallowGrid,
	tss: loadTss,
	coastIndex: async (bbox, o) => buildCoastIndex((await loadCoastFeatures(bbox, o)).features, bbox)
};
/**
* Tout ce qu'il faut au routeur pour une emprise : la terre (côte vraie), la
* marge (3 milles + les petits fonds), les zones interdites, et d'où ça vient.
*/
async function loadCharts(bbox, { cacheDir, cellDeg = .01, coastNm = 3, minDepth = 20, dilateMask, log = () => {}, sources = NODE_CHART_SOURCES }) {
	const { mask: land, source: coastSource } = await sources.coastMask(bbox, {
		cacheDir,
		cellDeg,
		log
	});
	const coast = dilateMask(land, coastNm);
	const shallow = await sources.shallowGrid(bbox, {
		cacheDir,
		cellDeg,
		minDepth,
		log
	});
	if (shallow) {
		const g = coast.data.grid;
		for (let i = 0; i < g.length; i++) if (shallow.grid[i]) g[i] = 1;
	}
	const tss = await sources.tss(bbox, {
		cacheDir,
		log
	});
	const forbiddenMask = buildLandMask([], bbox, cellDeg);
	for (const r of tss.rings) {
		const g = buildLandMask([{ geometry: {
			type: "Polygon",
			coordinates: [r]
		} }], bbox, cellDeg).data.grid;
		const out = forbiddenMask.data.grid;
		for (let i = 0; i < g.length; i++) if (g[i]) out[i] = 1;
	}
	const coastIndex = await sources.coastIndex(bbox, {
		cacheDir,
		log
	});
	return {
		land,
		coast,
		forbidden: tss.rings,
		forbiddenMask,
		coastIndex,
		sources: {
			coast: coastSource,
			depth: shallow ? `${shallow.source}, ${minDepth} m` : "aucune",
			tss: tss.source
		}
	};
}
//#endregion
//#region scripts/routing/lib/sun.mjs
var RAD$5 = Math.PI / 180;
/** Lever / coucher (ms UTC) le jour UTC de `dayMs`, à (lat, lon). null : soleil de minuit / nuit polaire. */
function sunTimes(lat, lon, dayMs) {
	const d = new Date(dayMs);
	d.setUTCHours(12, 0, 0, 0);
	const Jstar = Math.round((d.getTime() - Date.UTC(2e3, 0, 1, 12)) / 864e5) - lon / 360;
	const M = (357.5291 + .98560028 * Jstar) % 360;
	const L = (M + (1.9148 * Math.sin(M * RAD$5) + .02 * Math.sin(2 * M * RAD$5) + 3e-4 * Math.sin(3 * M * RAD$5)) + 180 + 102.9372) % 360;
	const Jtransit = Jstar + .0053 * Math.sin(M * RAD$5) - .0069 * Math.sin(2 * L * RAD$5);
	const decl = Math.asin(Math.sin(L * RAD$5) * Math.sin(23.4397 * RAD$5));
	const cosH = (Math.sin(-.833 * RAD$5) - Math.sin(lat * RAD$5) * Math.sin(decl)) / (Math.cos(lat * RAD$5) * Math.cos(decl));
	if (cosH < -1 || cosH > 1) return null;
	const H = Math.acos(cosH) / RAD$5 / 360;
	const base = Date.UTC(2e3, 0, 1, 12);
	return {
		rise: base + (Jtransit - H) * 864e5,
		set: base + (Jtransit + H) * 864e5
	};
}
/**
* L'arrivée est-elle de jour ? « De jour » : du lever jusqu'à une heure avant
* le coucher (le temps d'entrer et de s'amarrer avec de la lumière).
* → { day: bool, waitH: heures jusqu'au prochain lever si de nuit, rise, set }
*/
function arrivalLight(lat, lon, t, { marginBeforeSetH = 1 } = {}) {
	const s = sunTimes(lat, lon, t);
	if (!s) return {
		day: true,
		waitH: 0
	};
	if (t >= s.rise && t <= s.set - marginBeforeSetH * 36e5) return {
		day: true,
		waitH: 0,
		...s
	};
	return {
		day: false,
		waitH: ((t < s.rise ? s.rise : sunTimes(lat, lon, t + 864e5).rise) - t) / 36e5,
		...s
	};
}
//#endregion
//#region scripts/routing/lib/ensemble.mjs
/**
* La réponse de l'API d'ensembles → une grille PAR MEMBRE, au format exact de
* fetchWindGrid ({ model, member, lats, lons, times, u, v, gust }) : windAt et
* routeWorker.mjs s'en servent sans changement.
* `responses` : une réponse par point, dans l'ordre de gridPoints (latitude,
* puis longitude) — l'API renvoie les points dans l'ordre demandé.
* Le membre 0 est le contrôle (`wind_speed_10m`), puis `…_member01`, `…_member02`…
*/
function parseEnsemble(responses, { model, lats, lons }) {
	const pts = [];
	for (const la of lats) for (const lo of lons) pts.push([la, lo]);
	if (responses.length !== pts.length) throw new Error(`ensemble ${model} : ${responses.length} réponses pour ${pts.length} points`);
	const h0 = responses[0].hourly;
	const members = Object.keys(h0).map((k) => k === "wind_speed_10m" ? 0 : k.match(/^wind_speed_10m_member(\d+)$/)?.[1]).filter((x) => x != null).map(Number).sort((a, b) => a - b);
	const key = (base, n) => n === 0 ? base : `${base}_member${String(n).padStart(2, "0")}`;
	const allTimes = h0.time.map((t) => Date.parse(`${t}:00Z`));
	let T = allTimes.length;
	for (const r of responses) {
		const s = r.hourly.wind_speed_10m;
		const d = r.hourly.wind_direction_10m;
		let last = -1;
		for (let t = 0; t < T; t++) if (s[t] != null && d[t] != null) last = t;
		T = Math.min(T, last + 1);
	}
	const times = allTimes.slice(0, T);
	const I = lats.length;
	const J = lons.length;
	const nullPlane = Array.from({ length: I }, () => new Array(J).fill(null));
	const gust = new Array(T).fill(nullPlane);
	return members.map((n) => {
		const mk = () => Array.from({ length: T }, () => Array.from({ length: I }, () => new Array(J).fill(null)));
		const u = mk();
		const v = mk();
		const ks = key("wind_speed_10m", n);
		const kd = key("wind_direction_10m", n);
		pts.forEach(([la, lo], idx) => {
			const i = lats.indexOf(la);
			const j = lons.indexOf(lo);
			const h = responses[idx].hourly;
			for (let t = 0; t < T; t++) {
				const ws = h[ks]?.[t];
				const wd = h[kd]?.[t];
				if (ws == null || wd == null) continue;
				const a = (wd + 180) * Math.PI / 180;
				u[t][i][j] = ws * Math.sin(a);
				v[t][i][j] = ws * Math.cos(a);
			}
		});
		return {
			model,
			member: n,
			lats,
			lons,
			times,
			u,
			v,
			gust
		};
	});
}
/** Le centile p (0–1), interpolé entre les rangs (la méthode des tableurs). null si vide. */
function percentile(values, p) {
	const s = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
	if (!s.length) return null;
	const k = (s.length - 1) * p;
	const lo = Math.floor(k);
	const hi = Math.ceil(k);
	return s[lo] + (s[hi] - s[lo]) * (k - lo);
}
/**
* L'histogramme des arrivées : des cases de `binH` heures calées sur l'heure
* UTC ronde (00 h, 03 h…), comptées par modèle (pour l'empiler).
* `arrivals` : [{ t (ms), model }]. → { binMs, start, end, max, bins: [{ t0, t1, n, by }] }
*/
function arrivalBins(arrivals, { binH = 3 } = {}) {
	const binMs = binH * 36e5;
	if (!arrivals.length) return {
		binMs,
		start: null,
		end: null,
		max: 0,
		bins: []
	};
	const ts = arrivals.map((a) => a.t);
	const start = Math.floor(Math.min(...ts) / binMs) * binMs;
	const end = (Math.floor(Math.max(...ts) / binMs) + 1) * binMs;
	const bins = [];
	for (let t0 = start; t0 < end; t0 += binMs) bins.push({
		t0,
		t1: t0 + binMs,
		n: 0,
		by: {}
	});
	for (const a of arrivals) {
		const b = bins[Math.floor((a.t - start) / binMs)];
		b.n++;
		b.by[a.model] = (b.by[a.model] || 0) + 1;
	}
	return {
		binMs,
		start,
		end,
		max: Math.max(...bins.map((b) => b.n)),
		bins
	};
}
/** La largeur de case qui donne au plus ≈ 24 cases (1, 2, 3, 6 ou 12 h). */
var binHoursFor = (rangeH) => [
	1,
	2,
	3,
	6,
	12
].find((h) => rangeH / h <= 24) ?? 24;
var LEVELS$4 = [
	"élevée",
	"moyenne",
	"faible"
];
/**
* La confiance d'un ensemble. L'étalement P10–P90 des arrivées : < 6 h
* élevée, < 12 h moyenne, sinon faible. Puis un cran de moins si plus de 20 %
* des membres ne trouvent AUCUNE route dans les limites (du gros temps
* annoncé). Un membre qui s'arrête faute de prévision (« trop courte ») ne dit
* rien du passage : il ne compte ni comme bloqué, ni dans le total.
* → { level, widthH, blockedShare, reasons }
*/
function ensembleConfidence({ arrivals, blocked = 0, short = 0 }) {
	const routed = arrivals.length;
	const judged = routed + blocked;
	const reasons = [];
	if (routed < 2) {
		reasons.push(routed ? "un seul membre arrive" : "aucun membre n'arrive dans les limites");
		if (blocked) reasons.push(`${blocked} membre(s) sans route dans les limites`);
		if (short) reasons.push(`${short} membre(s) au-delà de la prévision (ne comptent pas)`);
		return {
			level: "faible",
			widthH: null,
			blockedShare: judged ? blocked / judged : null,
			reasons
		};
	}
	const widthH = (percentile(arrivals, .9) - percentile(arrivals, .1)) / 36e5;
	let k = widthH < 6 ? 0 : widthH < 12 ? 1 : 2;
	reasons.push(`arrivées P10–P90 étalées sur ${widthH.toFixed(1)} h`);
	const blockedShare = blocked / judged;
	if (blockedShare > .2) {
		k = Math.min(2, k + 1);
		reasons.push(`${blocked} membres sur ${judged} (${Math.round(blockedShare * 100)} %) sans route dans les limites : du gros temps annoncé`);
	} else if (blocked) reasons.push(`${blocked} membre(s) sur ${judged} sans route dans les limites`);
	if (short) reasons.push(`${short} membre(s) au-delà de la prévision (ne comptent pas)`);
	return {
		level: LEVELS$4[k],
		widthH,
		blockedShare,
		reasons
	};
}
/** La part des arrivées de jour au port d'arrivée (D6 : du lever à une heure avant le coucher). */
function daylightShare(arrivals, dest) {
	if (!arrivals.length) return null;
	return arrivals.filter((t) => arrivalLight(dest.lat, dest.lon, t).day).length / arrivals.length;
}
/** Le membre « médian » : celui dont l'arrivée est la plus proche de P50 (à égalité, le premier). */
function medianMember(members) {
	const ok = members.filter((m) => m.ok);
	const p50 = percentile(ok.map((m) => m.arrivalMs), .5);
	if (p50 == null) return null;
	return ok.reduce((best, m) => Math.abs(m.arrivalMs - p50) < Math.abs(best.arrivalMs - p50) ? m : best, ok[0]);
}
//#endregion
//#region scripts/routing/lib/weather.mjs
var MODELS = {
	ecmwf_ifs025: {
		label: "ECMWF IFS",
		kind: "physique"
	},
	ecmwf_aifs025_single: {
		label: "ECMWF AIFS (IA)",
		kind: "IA"
	},
	gfs_seamless: {
		label: "GFS (NOAA)",
		kind: "physique"
	},
	icon_seamless: {
		label: "ICON (DWD)",
		kind: "physique"
	},
	ukmo_seamless: {
		label: "UK Met Office",
		kind: "physique"
	},
	meteofrance_seamless: {
		label: "Météo-France",
		kind: "physique"
	}
};
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var KEY = process.env.OPEN_METEO_KEY || "";
/** L'URL d'un service Open-Meteo (`api`, `marine-api`, `ensemble-api`), avec la clé si on en a une. */
function omUrl(service, pathAndQuery) {
	return KEY ? `https://customer-${service}.open-meteo.com${pathAndQuery}&apikey=${encodeURIComponent(KEY)}` : `https://${service}.open-meteo.com${pathAndQuery}`;
}
var weatherError = (msg, code) => Object.assign(new Error(msg), { code });
async function getJson(url) {
	for (let attempt = 0; attempt < 6; attempt++) {
		const r = await fetch(url, { signal: AbortSignal.timeout(6e4) });
		if (r.ok) return r.json();
		if (r.status === 429) {
			await sleep(61e3);
			continue;
		}
		if (r.status >= 500) {
			await sleep(2e3 * (attempt + 1));
			continue;
		}
		const text = (await r.text()).slice(0, 200);
		throw weatherError(`${r.status} ${text}`, /limit|quota/i.test(text) ? "weather-quota" : "weather-http");
	}
	throw weatherError("Open-Meteo : trop de refus", "weather-quota");
}
/**
* Le cache d'une grille, réutilisé jusqu'à `maxAgeH` heures (26 oct.) : les
* modèles ne changent que toutes les 6 h, et le quota gratuit d'Open-Meteo
* (10 000 appels / jour, par adresse) tombait en une journée de calculs —
* chaque calcul retéléchargeait ≈ 1 450 points parce que la clé changeait à
* chaque heure. → le chemin du fichier à lire (le plus récent encore bon), ou
* celui à écrire (l'heure courante).
*/
function cachedFile(cacheDir, prefix, maxAgeH = 3) {
	const now = /* @__PURE__ */ new Date();
	const hour = now.toISOString().slice(0, 13);
	const fresh = path.join(cacheDir, `${prefix}-${hour}.json`);
	if (fs.existsSync(fresh)) return { read: fresh };
	for (let h = 1; h <= maxAgeH; h++) {
		const f = path.join(cacheDir, `${prefix}-${(/* @__PURE__ */ new Date(now.getTime() - h * 36e5)).toISOString().slice(0, 13)}.json`);
		if (fs.existsSync(f)) return { read: f };
	}
	return { write: fresh };
}
function coveringCache(cacheDir, kind, bbox, step, days, maxAgeH, nowMs = Date.now()) {
	if (!cacheDir || !fs.existsSync(cacheDir)) return null;
	const [w, s, e, n] = bbox;
	let best = null;
	for (const f of fs.readdirSync(cacheDir)) {
		if (!f.startsWith(`${kind}-`)) continue;
		const m = /^(.+)-([\d.]+)-(\d+)j-(\d{4}-\d\d-\d\dT\d\d)\.json$/.exec(f.slice(kind.length + 1));
		if (!m) continue;
		const b = m[1].split("_").map(Number);
		if (b.length !== 4 || b.some((x) => !Number.isFinite(x))) continue;
		if (Number(m[2]) !== step || Number(m[3]) < days) continue;
		if (!(b[0] <= w + 1e-9 && b[1] <= s + 1e-9 && b[2] >= e - 1e-9 && b[3] >= n - 1e-9)) continue;
		const at = Date.parse(`${m[4]}:00:00Z`);
		if (!Number.isFinite(at) || nowMs - at > maxAgeH * 36e5 || nowMs - at < -36e5) continue;
		if (!best || at > best.at) best = {
			file: path.join(cacheDir, f),
			at
		};
	}
	return best;
}
/** Télécharge, sinon (Open-Meteo refuse, réseau coupé) la grille d'avant, marquée. */
async function withStaleFallback(cacheDir, kind, bbox, step, days, download) {
	try {
		return await download();
	} catch (err) {
		const c = coveringCache(cacheDir, kind, bbox, step, days, 48);
		if (!c) throw err;
		const grid = JSON.parse(fs.readFileSync(c.file, "utf8"));
		const fetchedMs = Date.parse(grid.fetchedAt) || c.at;
		grid.stale = {
			fetchedAt: new Date(fetchedMs).toISOString(),
			ageH: Math.round((Date.now() - fetchedMs) / 36e4) / 10,
			reason: String(err?.message || err).slice(0, 120)
		};
		return grid;
	}
}
/**
* ADR-0039 D26 (ROUTE-021) — « 🗄 MÉTÉO PRÉCÉDENTE » : AUCUN téléchargement. La
* plus récente grille en cache qui COUVRE l'emprise (même pas, au moins autant
* de jours), QUEL QUE SOIT SON ÂGE (pas limitée aux 48 h de ROUTE-013). Elle
* porte `previous: { fetchedAt, ageH, file }` — le conseil le dit, par modèle.
* → la grille | null (rien de couvrant : le modèle manque, et c'est dit).
*/
function previousGrid(cacheDir, kind, bbox, step = 1, days = 10, nowMs = Date.now()) {
	const c = coveringCache(cacheDir, kind, bbox, step, days, Infinity, nowMs);
	if (!c) return null;
	const grid = JSON.parse(fs.readFileSync(c.file, "utf8"));
	const fetchedMs = Date.parse(grid.fetchedAt) || c.at;
	grid.previous = {
		fetchedAt: new Date(fetchedMs).toISOString(),
		ageH: Math.round((nowMs - fetchedMs) / 36e4) / 10,
		file: path.basename(c.file)
	};
	return grid;
}
/**
* D26 — les ENSEMBLES de la « météo précédente » : le plus récent fichier brut
* d'ensemble en cache qui couvre l'emprise arrondie (au pas), quel que soit son
* âge ; lu sur SA grille (son emprise à lui). → [membres] (`.download`,
* `.previous`) | null.
*/
function previousEnsembleGrids(model, bbox, { step = 2, days = 10, cacheDir, nowMs = Date.now() } = {}) {
	if (!cacheDir || !fs.existsSync(cacheDir)) return null;
	const [w, s, e, n] = bbox;
	const gb = [
		w,
		s,
		w + Math.ceil((e - w) / step) * step,
		s + Math.ceil((n - s) / step) * step
	];
	const kind = `ens-${model}`;
	let best = null;
	for (const f of fs.readdirSync(cacheDir)) {
		if (!f.startsWith(`${kind}-`)) continue;
		const m = /^(.+)-([\d.]+)-(\d+)j-(\d{4}-\d\d-\d\dT\d\d)\.json$/.exec(f.slice(kind.length + 1));
		if (!m) continue;
		const b = m[1].split("_").map(Number);
		if (b.length !== 4 || b.some((x) => !Number.isFinite(x)) || Number(m[2]) !== step || Number(m[3]) < days) continue;
		if (!(b[0] <= gb[0] + 1e-9 && b[1] <= gb[1] + 1e-9 && b[2] >= gb[2] - 1e-9 && b[3] >= gb[3] - 1e-9)) continue;
		const at = Date.parse(`${m[4]}:00:00Z`);
		if (!Number.isFinite(at) || nowMs - at < -36e5) continue;
		if (!best || at > best.at) best = {
			file: path.join(cacheDir, f),
			at,
			b
		};
	}
	if (!best) return null;
	const t0 = Date.now();
	const txt = fs.readFileSync(best.file, "utf8");
	const { lats, lons } = gridPoints(best.b, step);
	const grids = parseEnsemble(JSON.parse(txt), {
		model,
		lats,
		lons
	});
	grids.download = {
		bytes: txt.length,
		ms: Date.now() - t0,
		cached: path.basename(best.file)
	};
	grids.previous = {
		fetchedAt: new Date(best.at).toISOString(),
		ageH: Math.round((nowMs - best.at) / 36e4) / 10,
		file: path.basename(best.file)
	};
	return grids;
}
/** La grille des points : emprise [ouest, sud, est, nord], pas en degrés. */
function gridPoints(bbox, step) {
	const [w, s, e, n] = bbox;
	const lats = [];
	const lons = [];
	for (let la = s; la <= n + 1e-9; la += step) lats.push(Math.round(la * 1e3) / 1e3);
	for (let lo = w; lo <= e + 1e-9; lo += step) lons.push(Math.round(lo * 1e3) / 1e3);
	return {
		lats,
		lons
	};
}
/**
* Le vent d'un modèle sur la grille, en cache dans `cacheDir`.
* → { model, lats, lons, times (ms), u[t][i][j], v[t][i][j], gust[t][i][j] }
*/
async function fetchWindGrid(model, bbox, { step = 1, days = 7, cacheDir, log = () => {} } = {}) {
	const { lats, lons } = gridPoints(bbox, step);
	const c = cacheDir ? cachedFile(cacheDir, `wind-${model}-${bbox.join("_")}-${step}-${days}j`) : null;
	if (c?.read) return JSON.parse(fs.readFileSync(c.read, "utf8"));
	const cover = coveringCache(cacheDir, `wind-${model}`, bbox, step, days, 3);
	if (cover) return JSON.parse(fs.readFileSync(cover.file, "utf8"));
	const file = c?.write || null;
	return withStaleFallback(cacheDir, `wind-${model}`, bbox, step, days, async () => {
		const pts = [];
		for (const la of lats) for (const lo of lons) pts.push([la, lo]);
		const res = new Array(pts.length);
		for (let k = 0; k < pts.length; k += 60) {
			const chunk = pts.slice(k, k + 60);
			const d = await getJson(omUrl("api", `/v1/forecast?latitude=${chunk.map((p) => p[0]).join(",")}&longitude=${chunk.map((p) => p[1]).join(",")}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&forecast_days=${days}&models=${model}&timezone=GMT`));
			(Array.isArray(d) ? d : [d]).forEach((x, i) => {
				res[k + i] = x;
			});
			log(`  ${model} : ${Math.min(k + 60, pts.length)}/${pts.length} points`);
		}
		const times = res[0].hourly.time.map((t) => Date.parse(`${t}:00Z`));
		const T = times.length;
		const I = lats.length;
		const J = lons.length;
		const mk = () => Array.from({ length: T }, () => Array.from({ length: I }, () => new Array(J).fill(null)));
		const u = mk();
		const v = mk();
		const gust = mk();
		pts.forEach(([la, lo], idx) => {
			const i = lats.indexOf(la);
			const j = lons.indexOf(lo);
			const h = res[idx].hourly;
			for (let t = 0; t < T; t++) {
				const ws = h.wind_speed_10m[t];
				const wd = h.wind_direction_10m[t];
				if (ws == null || wd == null) continue;
				const a = (wd + 180) * Math.PI / 180;
				u[t][i][j] = ws * Math.sin(a);
				v[t][i][j] = ws * Math.cos(a);
				gust[t][i][j] = h.wind_gusts_10m?.[t] ?? null;
			}
		});
		const grid = {
			model,
			lats,
			lons,
			times,
			u,
			v,
			gust,
			fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		if (file) {
			fs.mkdirSync(cacheDir, { recursive: true });
			fs.writeFileSync(file, JSON.stringify(grid));
		}
		return grid;
	});
}
/** Les vagues (hauteur significative, m) sur la grille, API marine. */
async function fetchWaveGrid(bbox, { step = 1, days = 7, cacheDir, log = () => {} } = {}) {
	const { lats, lons } = gridPoints(bbox, step);
	const c = cacheDir ? cachedFile(cacheDir, `waves-${bbox.join("_")}-${step}-${days}j`) : null;
	if (c?.read) return JSON.parse(fs.readFileSync(c.read, "utf8"));
	const cover = coveringCache(cacheDir, "waves", bbox, step, days, 3);
	if (cover) return JSON.parse(fs.readFileSync(cover.file, "utf8"));
	const file = c?.write || null;
	return withStaleFallback(cacheDir, "waves", bbox, step, days, async () => {
		const pts = [];
		for (const la of lats) for (const lo of lons) pts.push([la, lo]);
		const res = new Array(pts.length);
		for (let k = 0; k < pts.length; k += 60) {
			const chunk = pts.slice(k, k + 60);
			const d = await getJson(omUrl("marine-api", `/v1/marine?latitude=${chunk.map((p) => p[0]).join(",")}&longitude=${chunk.map((p) => p[1]).join(",")}&hourly=wave_height&forecast_days=${days}&timezone=GMT`));
			(Array.isArray(d) ? d : [d]).forEach((x, i) => {
				res[k + i] = x;
			});
			log(`  vagues : ${Math.min(k + 60, pts.length)}/${pts.length} points`);
		}
		const times = res[0].hourly.time.map((t) => Date.parse(`${t}:00Z`));
		const hs = Array.from({ length: times.length }, () => Array.from({ length: lats.length }, () => new Array(lons.length).fill(null)));
		pts.forEach(([la, lo], idx) => {
			const i = lats.indexOf(la);
			const j = lons.indexOf(lo);
			res[idx].hourly.wave_height.forEach((val, t) => {
				hs[t][i][j] = val;
			});
		});
		const grid = {
			lats,
			lons,
			times,
			hs,
			fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		if (file) {
			fs.mkdirSync(cacheDir, { recursive: true });
			fs.writeFileSync(file, JSON.stringify(grid));
		}
		return grid;
	});
}
function bilinear(field, lats, lons, lat, lon) {
	const step = lats[1] - lats[0];
	const fi = (lat - lats[0]) / step;
	const fj = (lon - lons[0]) / (lons[1] - lons[0]);
	if (fi < 0 || fj < 0 || fi > lats.length - 1 || fj > lons.length - 1) return null;
	const i0 = Math.min(lats.length - 2, Math.floor(fi));
	const j0 = Math.min(lons.length - 2, Math.floor(fj));
	const ti = fi - i0;
	const tj = fj - j0;
	const c = [
		field[i0][j0],
		field[i0][j0 + 1],
		field[i0 + 1][j0],
		field[i0 + 1][j0 + 1]
	];
	if (c.some((x) => x == null)) {
		const ok = c.filter((x) => x != null);
		return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
	}
	return (c[0] * (1 - tj) + c[1] * tj) * (1 - ti) + (c[2] * (1 - tj) + c[3] * tj) * ti;
}
var timeIdx = (times, t) => {
	if (t <= times[0]) return [
		0,
		0,
		0
	];
	const n = times.length;
	if (!(t <= times[n - 1])) return null;
	let lo = 0;
	let hi = n - 2;
	while (lo < hi) {
		const mid = lo + hi >> 1;
		if (t <= times[mid + 1]) hi = mid;
		else lo = mid + 1;
	}
	return [
		lo,
		lo + 1,
		(t - times[lo]) / (times[lo + 1] - times[lo])
	];
};
/** Le vent à (lat, lon, t) : { tws, twd (d'où il vient), gust } ou null (hors prévision). */
function windAt(grid, lat, lon, t) {
	const ti = timeIdx(grid.times, t);
	if (!ti) return null;
	const [k0, k1, f] = ti;
	const pick = (fld) => {
		const a = bilinear(fld[k0], grid.lats, grid.lons, lat, lon);
		const b = bilinear(fld[k1], grid.lats, grid.lons, lat, lon);
		return a == null || b == null ? a ?? b : a * (1 - f) + b * f;
	};
	const u = pick(grid.u);
	const v = pick(grid.v);
	if (u == null || v == null) return null;
	return {
		tws: Math.hypot(u, v),
		twd: (Math.atan2(u, v) * 180 / Math.PI + 180 + 360) % 360,
		gust: pick(grid.gust)
	};
}
function waveAt(grid, lat, lon, t) {
	if (!grid) return null;
	const ti = timeIdx(grid.times, t);
	if (!ti) return null;
	const [k0, k1, f] = ti;
	const a = bilinear(grid.hs[k0], grid.lats, grid.lons, lat, lon);
	const b = bilinear(grid.hs[k1], grid.lats, grid.lons, lat, lon);
	return a == null || b == null ? a ?? b : a * (1 - f) + b * f;
}
var ENSEMBLES = {
	ecmwf_ifs025: {
		label: "ECMWF IFS ENS",
		members: 51,
		kind: "physique"
	},
	ecmwf_aifs025: {
		label: "ECMWF AIFS ENS (IA)",
		members: 51,
		kind: "IA"
	},
	gfs025: {
		label: "GFS ENS (NOAA)",
		members: 31,
		kind: "physique"
	},
	icon_seamless: {
		label: "ICON EPS (DWD)",
		members: 40,
		kind: "physique"
	}
};
/**
* Tous les membres d'un modèle d'ensemble sur une grille GROSSIÈRE (2° : ≈ 90
* points au lieu de ≈ 200 — c'est le téléchargement qui coûte, pas le calcul).
* Les réponses brutes vont en cache (une par modèle, emprise, pas, durée et
* heure de lancement), puis parseEnsemble en fait une grille par membre, au
* format de fetchWindGrid.
* ⚠️ Le cache sert aussi s'il a moins de `maxAgeH` heures : l'API gratuite
* compte un point d'ensemble comme ≈ 10 appels (un par tranche de 10
* variables : 51 membres × 2), soit ≈ 2 200 appels pour Gibraltar → Las
* Palmas, contre 600 à la minute, 5 000 à l'heure et 10 000 par jour. Et un
* ensemble ne change qu'à chaque run (toutes les 6 à 12 h).
* → [grille du membre 0 (contrôle), 1, 2…], avec `.download = { bytes, ms, cached }`.
*/
async function fetchEnsembleGrids(model, bbox, { step = 2, days = 10, cacheDir, maxAgeH = 3, log = () => {} } = {}) {
	const [w, s, e, n] = bbox;
	const gb = [
		w,
		s,
		w + Math.ceil((e - w) / step) * step,
		s + Math.ceil((n - s) / step) * step
	];
	const { lats, lons } = gridPoints(gb, step);
	const hour = (/* @__PURE__ */ new Date()).toISOString().slice(0, 13);
	const stem = `ens-${model}-${gb.join("_")}-${step}-${days}j-`;
	const file = cacheDir ? path.join(cacheDir, `${stem}${hour}.json`) : null;
	const recent = cacheDir && fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.startsWith(stem) && Date.now() - Date.parse(`${f.slice(stem.length, -5)}:00:00Z`) < (maxAgeH + 1) * 36e5).sort().pop() : null;
	const t0 = Date.now();
	let res;
	let bytes;
	let cached = false;
	if (recent) {
		const txt = fs.readFileSync(path.join(cacheDir, recent), "utf8");
		res = JSON.parse(txt);
		bytes = txt.length;
		cached = recent;
	} else {
		const pts = [];
		for (const la of lats) for (const lo of lons) pts.push([la, lo]);
		res = new Array(pts.length);
		for (let k = 0; k < pts.length; k += 20) {
			const chunk = pts.slice(k, k + 20);
			const tq = Date.now();
			const d = await getJson(omUrl("ensemble-api", `/v1/ensemble?latitude=${chunk.map((p) => p[0]).join(",")}&longitude=${chunk.map((p) => p[1]).join(",")}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&forecast_days=${days}&models=${model}&timezone=GMT`));
			(Array.isArray(d) ? d : [d]).forEach((x, i) => {
				res[k + i] = x;
			});
			log(`  ${model} (ensemble) : ${Math.min(k + 20, pts.length)}/${pts.length} points (${((Date.now() - tq) / 1e3).toFixed(1)} s)`);
		}
		const txt = JSON.stringify(res);
		bytes = txt.length;
		if (file) {
			fs.mkdirSync(cacheDir, { recursive: true });
			fs.writeFileSync(file, txt);
		}
	}
	const grids = parseEnsemble(res, {
		model,
		lats,
		lons
	});
	grids.download = {
		bytes,
		ms: Date.now() - t0,
		cached
	};
	return grids;
}
var DUMMY_SCENARIOS = [
	"trade",
	"calm",
	"gale",
	"front"
];
var DUMMY_DEFAULT = {
	seed: 1,
	scenario: "trade"
};
var H$1 = 36e5;
/** La mer du vent : Hs ≈ 0,25 + k × U² (U en nœuds, le vent des 6 dernières heures) — 20 nds ≈ 1,65 m, 26 nds ≈ 2,6 m, plus la houle. */
var WAVE_K = .0035;
var RAD$4 = Math.PI / 180;
/** Les 6 modèles déterministes, leurs horizons réels (heures) et leurs rafales. */
var DUMMY_MODELS = {
	ecmwf_ifs025: {
		horizonH: 240,
		gust: true,
		smooth: 1
	},
	ecmwf_aifs025_single: {
		horizonH: 240,
		gust: false,
		smooth: .5
	},
	gfs_seamless: {
		horizonH: 240,
		gust: true,
		smooth: 1.1
	},
	icon_seamless: {
		horizonH: 180,
		gust: true,
		smooth: 1
	},
	ukmo_seamless: {
		horizonH: 156,
		gust: true,
		smooth: .9
	},
	meteofrance_seamless: {
		horizonH: 97,
		gust: true,
		smooth: 1.2
	}
};
/** Les 4 ensembles (173 membres comme les vrais) et le modèle déterministe dont le contrôle reprend la perturbation. */
var DUMMY_ENSEMBLES = {
	ecmwf_ifs025: {
		members: 51,
		horizonH: 240,
		det: "ecmwf_ifs025"
	},
	ecmwf_aifs025: {
		members: 51,
		horizonH: 240,
		det: "ecmwf_aifs025_single"
	},
	gfs025: {
		members: 31,
		horizonH: 240,
		det: "gfs_seamless"
	},
	icon_seamless: {
		members: 40,
		horizonH: 181,
		det: "icon_seamless"
	}
};
/**
* Les SCÉNARIOS — de quoi exercer chaque chemin du moteur :
*  · `trade` (alizés) : 14–20 nds du NE, une dépression lointaine — le cas courant ;
*  · `calm` (petit temps) : 2–7 nds, direction tournante — beaucoup de moteur,
*    le gazole, la réserve, le plafond moteur de Voile relevé (ROUTE-024) ;
*  · `gale` (coup de vent) : une dépression creuse qui passe au nord, 22–28 nds
*    sur le passage, des vagues de 3 m — la marge relâchée, des modèles bloqués ;
*  · `front` : un front froid qui balaie le passage, des modèles en désaccord
*    sur l'heure (6 h) — une confiance faible, des ensembles étalés.
*/
var SCENARIOS = {
	trade: {
		base: 15,
		dir: 30,
		latGain: .01,
		dirSwing: 12,
		low: {
			vmax: 7,
			r: 6,
			lat: 2,
			lon: .15,
			vLat: .01,
			vLon: .35,
			t0: 30,
			t1: 200
		},
		front: null,
		diurnal: .08,
		coastAccel: .12,
		swell: .4,
		gustF: 1.25,
		noise: 1.4,
		spread: 1
	},
	calm: {
		base: 4,
		dir: 10,
		latGain: .02,
		dirSwing: 140,
		low: null,
		front: null,
		diurnal: .4,
		coastAccel: .12,
		swell: .4,
		gustF: 1.4,
		noise: 1.2,
		spread: .8
	},
	gale: {
		base: 12,
		dir: 20,
		latGain: .03,
		dirSwing: 10,
		low: {
			vmax: 28,
			r: 3.5,
			lat: .6,
			lon: -.1,
			vLat: 0,
			vLon: .5,
			t0: 6,
			t1: 120
		},
		front: null,
		diurnal: .06,
		coastAccel: .2,
		swell: .9,
		gustF: 1.35,
		noise: 1.8,
		spread: 1.2
	},
	front: {
		base: 9,
		dir: 40,
		latGain: .02,
		dirSwing: 10,
		low: {
			vmax: 18,
			r: 5,
			lat: 1.1,
			lon: .1,
			vLat: .02,
			vLon: .5,
			t0: 0,
			t1: 160
		},
		front: {
			speedDegH: .22,
			startH: 18,
			pre: 17,
			post: 22,
			preDir: 225,
			postDir: 315,
			width: .45,
			band: 1,
			gust: 1.6,
			tiltDeg: 35
		},
		diurnal: .08,
		coastAccel: .3,
		swell: .9,
		gustF: 1.3,
		noise: 1.8,
		spread: 2
	}
};
function hashStr(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
function mulberry32(a) {
	return () => {
		a = a + 1831565813 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
/** Un tirage reproductible pour (graine, étiquettes…). */
var rngFor = (seed, ...tags) => mulberry32(hashStr(`${seed}|${tags.join("|")}`));
var gauss = (r) => {
	const u = Math.max(1e-12, r());
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};
var clamp$1 = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
/** Une graine propre : un entier de 1 à 999 999 (« 42 », 42.7 → 42 ; sinon la graine par défaut). */
function cleanSeed(x) {
	const n = Math.floor(Number(x));
	return Number.isFinite(n) && n >= 1 && n <= 999999 ? n : DUMMY_DEFAULT.seed;
}
var cleanScenario = (s) => DUMMY_SCENARIOS.includes(s) ? s : DUMMY_DEFAULT.scenario;
function dummyGridPoints(bbox, step) {
	const [w, s, e, n] = bbox;
	const lats = [];
	const lons = [];
	for (let la = s; la <= n + 1e-9; la += step) lats.push(Math.round(la * 1e3) / 1e3);
	for (let lo = w; lo <= e + 1e-9; lo += step) lons.push(Math.round(lo * 1e3) / 1e3);
	return {
		lats,
		lons
	};
}
/** Les heures d'une prévision Open-Meteo : de 00 Z du jour de `nowMs`, `days` × 24 heures. */
function dummyTimes(nowMs, days = 10, hours = null) {
	const t0 = Math.floor(nowMs / 864e5) * 864e5;
	return Array.from({ length: hours ?? days * 24 }, (_, k) => t0 + k * H$1);
}
/** Des ondes lisses (bruit) : K modes (lat, lon, temps), phases tirées. */
function waves(r, k = 4, scale = 1) {
	return Array.from({ length: k }, () => ({
		a: (.4 + r()) * scale / k * 2,
		kla: (.25 + r() * .6) * (r() < .5 ? -1 : 1),
		klo: (.25 + r() * .6) * (r() < .5 ? -1 : 1),
		w: 2 * Math.PI / (18 + r() * 54),
		p: r() * 2 * Math.PI
	}));
}
var waveSum = (ws, lat, lon, tau) => {
	let s = 0;
	for (const m of ws) s += m.a * Math.sin(m.kla * lat + m.klo * lon + m.w * tau + m.p);
	return s;
};
/**
* Une PERTURBATION (ce qui distingue un modèle, ou un membre, du fond) — tirée
* de la graine. `amp` : son ampleur (0 = le fond lui-même) ; `lead` grandit
* avec l'échéance (les modèles divergent avec le temps).
*/
function perturbation(r, amp, sc) {
	const g = () => gauss(r);
	return {
		speed: clamp$1(1 + .07 * amp * g(), .8, 1.2),
		dir: 9 * amp * g(),
		timeH: 4 * amp * sc.spread * g(),
		dLat: .6 * amp * g(),
		dLon: .6 * amp * g(),
		noise: waves(r, 3, sc.noise * .6 * amp)
	};
}
/**
* Le champ d'UN modèle (ou d'un membre). → (lat, lon, ms) → { u, v, gust } (nœuds).
* ctx = { sc (le scénario), base (les ondes du fond), t0 (00 Z), coast(i, j) | null }.
*/
function fieldOf(ctx, pert, { smooth = 1 } = {}) {
	const { sc, base, t0, bboxC } = ctx;
	const lowP = sc.low;
	const fr = sc.front;
	return (lat, lon, ms, coastF = 1) => {
		const tau = (ms - t0) / H$1;
		const grow = .35 + .65 * clamp$1(tau / 120, 0, 2);
		const sp0 = Math.max(0, sc.base * (1 + sc.latGain * (bboxC.lat - lat) * 3));
		const d0 = sc.dir + sc.dirSwing * Math.sin(2 * Math.PI * tau / 96 + base.phase) + pert.dir * grow;
		let u = sp0 * Math.sin((d0 + 180) * RAD$4);
		let v = sp0 * Math.cos((d0 + 180) * RAD$4);
		if (lowP) {
			const tl = tau - pert.timeH * grow;
			const env = smoothBump(tl, lowP.t0, lowP.t1);
			if (env > 0) {
				const cLat = bboxC.n + lowP.lat * bboxC.h * .5 + lowP.vLat * tl + pert.dLat * grow - bboxC.h * .5;
				const dx = (lon - (bboxC.w + lowP.lon * bboxC.wd + lowP.vLon * tl * .25 + pert.dLon * grow)) * Math.cos(lat * RAD$4);
				const dy = lat - cLat;
				const rr = Math.hypot(dx, dy);
				if (rr > 1e-6) {
					const x = rr / lowP.r;
					const vt = lowP.vmax * env * x * Math.exp(.5 * (1 - x * x));
					u += vt * (-dy / rr - .3 * dx / rr);
					v += vt * (dx / rr - .3 * dy / rr);
				}
			}
		}
		let gustF = sc.gustF;
		if (fr) {
			const tf = tau - pert.timeH * 1.5 * grow;
			const d = (lon - (bboxC.w - 1 + fr.speedDegH * (tf - fr.startH) + pert.dLon * grow)) * Math.cos(lat * RAD$4) - (lat - bboxC.lat) * Math.tan(fr.tiltDeg * RAD$4);
			const s = 1 / (1 + Math.exp(-d / fr.width));
			const south = clamp$1((lat - (bboxC.s - 2)) / (bboxC.h + 2), .35, 1);
			const pre = fr.pre * south;
			const post = fr.post * south;
			const pu = pre * Math.sin((fr.preDir + 180) * RAD$4);
			const pv = pre * Math.cos((fr.preDir + 180) * RAD$4);
			const qu = post * Math.sin((fr.postDir + 180) * RAD$4);
			const qv = post * Math.cos((fr.postDir + 180) * RAD$4);
			const wFront = clamp$1((tf - fr.startH + 12) / 12, 0, 1);
			u = u * (1 - .7 * wFront) + wFront * (s * pu + (1 - s) * qu);
			v = v * (1 - .7 * wFront) + wFront * (s * pv + (1 - s) * qv);
			if (Math.abs(d) < fr.band) gustF = Math.max(gustF, fr.gust * (1 - Math.abs(d) / fr.band) + sc.gustF * (Math.abs(d) / fr.band));
		}
		u += waveSum(base.nu, lat, lon, tau) * smooth + waveSum(pert.noise, lat, lon, tau) * smooth * grow;
		v += waveSum(base.nv, lat, lon, tau) * smooth + waveSum(pert.noise, lon, lat, tau + 7) * smooth * grow;
		const solarH = (ms / H$1 % 24 + 24 + lon / 15) % 24;
		const k = pert.speed * (1 + sc.diurnal * Math.cos(2 * Math.PI * (solarH - 15) / 24)) * coastF;
		u *= k;
		v *= k;
		const gust = Math.hypot(u, v) * gustF * (1 + .06 * Math.sin(lat * 3.1 + lon * 2.3 + tau * .7)) + 1.5;
		return {
			u,
			v,
			gust
		};
	};
}
function smoothBump(t, a, b) {
	if (t <= a || t >= b) return 0;
	const ramp = Math.min(24, (b - a) / 3);
	const up = clamp$1((t - a) / ramp, 0, 1);
	const down = clamp$1((b - t) / ramp, 0, 1);
	const s = (x) => x * x * (3 - 2 * x);
	return s(Math.min(up, down));
}
/** Le facteur côtier d'un point : 1 au large ; jusqu'à 1 + accel entre deux terres (caps, îles). `isLand` injectée. */
function coastFactor(isLand, lat, lon, accel) {
	if (!isLand || !(accel > 0)) return 1;
	if (isLand(lat, lon)) return 1;
	let n = 0;
	let tot = 0;
	for (const r of [.25, .5]) for (let k = 0; k < 8; k++) {
		const a = (k * 45 + (r === .5 ? 22.5 : 0)) * RAD$4;
		tot++;
		if (isLand(lat + r * Math.cos(a), lon + r * Math.sin(a) / Math.cos(lat * RAD$4))) n++;
	}
	const share = n / tot;
	return share > 0 && share < .75 ? 1 + accel * Math.min(1, 4 * share * (1 - share)) : 1;
}
/** Le contexte commun (le fond) d'une graine, d'un scénario et d'une emprise. */
function dummyContext({ seed, scenario, bbox, nowMs, isLand = null }) {
	const sc = SCENARIOS[cleanScenario(scenario)];
	const s = cleanSeed(seed);
	const r = rngFor(s, scenario, "base");
	const [w, so, e, n] = bbox;
	return {
		seed: s,
		scenario: cleanScenario(scenario),
		sc,
		isLand,
		t0: Math.floor(nowMs / 864e5) * 864e5,
		base: {
			phase: r() * 2 * Math.PI,
			nu: waves(r, 4, sc.noise),
			nv: waves(r, 4, sc.noise)
		},
		bboxC: {
			w,
			s: so,
			e,
			n,
			lat: (so + n) / 2,
			lon: (w + e) / 2,
			h: n - so,
			wd: e - w
		}
	};
}
/** Une grille de vent (format de `fetchWindGrid`, ou d'un membre de `parseEnsemble`) d'un champ. */
function windGrid(ctx, field, { lats, lons, times, horizonH, gust = true, extra = {} }) {
	const T = times.length;
	const I = lats.length;
	const J = lons.length;
	const cf = lats.map((la) => lons.map((lo) => coastFactor(ctx.isLand, la, lo, ctx.sc.coastAccel)));
	const lastMs = ctx.t0 + horizonH * H$1;
	const u = new Array(T);
	const v = new Array(T);
	const g = gust ? new Array(T) : null;
	const nullPlane = gust ? null : Array.from({ length: I }, () => new Array(J).fill(null));
	for (let t = 0; t < T; t++) {
		const ut = new Array(I);
		const vt = new Array(I);
		const gt = gust ? new Array(I) : null;
		const beyond = times[t] > lastMs;
		for (let i = 0; i < I; i++) {
			const ur = new Array(J);
			const vr = new Array(J);
			const gr = gust ? new Array(J) : null;
			for (let j = 0; j < J; j++) {
				if (beyond) {
					ur[j] = null;
					vr[j] = null;
					if (gr) gr[j] = null;
					continue;
				}
				const x = field(lats[i], lons[j], times[t], cf[i][j]);
				ur[j] = Math.round(x.u * 100) / 100;
				vr[j] = Math.round(x.v * 100) / 100;
				if (gr) gr[j] = Math.round(x.gust * 10) / 10;
			}
			ut[i] = ur;
			vt[i] = vr;
			if (gt) gt[i] = gr;
		}
		u[t] = ut;
		v[t] = vt;
		if (g) g[t] = gt;
	}
	return {
		lats,
		lons,
		times,
		u,
		v,
		gust: g || new Array(T).fill(nullPlane),
		...extra
	};
}
var dummyTag = (ctx) => ({
	seed: ctx.seed,
	scenario: ctx.scenario,
	v: 1
});
/**
* Les 6 modèles + les vagues, au format exact de `fetchWindGrid` / `fetchWaveGrid`.
* → { grids: { modèle: grille }, waves, meta: { seed, scenario, v } }
*/
function dummyWeather({ seed = DUMMY_DEFAULT.seed, scenario = DUMMY_DEFAULT.scenario, bbox, nowMs = Date.now(), step = 1, days = 10, isLand = null, models = Object.keys(DUMMY_MODELS) } = {}) {
	const ctx = dummyContext({
		seed,
		scenario,
		bbox,
		nowMs,
		isLand
	});
	const { lats, lons } = dummyGridPoints(bbox, step);
	const times = dummyTimes(nowMs, days);
	const fetchedAt = new Date(ctx.t0).toISOString();
	const grids = {};
	for (const m of models) {
		const M = DUMMY_MODELS[m] || DUMMY_MODELS.ecmwf_ifs025;
		grids[m] = windGrid(ctx, fieldOf(ctx, m === "ecmwf_ifs025" ? perturbation(rngFor(ctx.seed, ctx.scenario, "model", m), .35, ctx.sc) : perturbation(rngFor(ctx.seed, ctx.scenario, "model", m), 1, ctx.sc), { smooth: M.smooth }), {
			lats,
			lons,
			times,
			horizonH: M.horizonH,
			gust: M.gust,
			extra: {
				model: m,
				fetchedAt,
				dummy: dummyTag(ctx)
			}
		});
		if (!M.gust) grids[m].gust = times.map(() => lats.map(() => lons.map(() => null)));
	}
	return {
		grids,
		waves: dummyWaves(ctx, {
			lats,
			lons,
			times,
			fetchedAt
		}),
		meta: dummyTag(ctx)
	};
}
/** Les vagues : une houle + la mer du vent des 6 dernières heures (le fond, sans perturbation). */
function dummyWaves(ctx, { lats, lons, times, fetchedAt }) {
	const field = fieldOf(ctx, perturbation(rngFor(ctx.seed, ctx.scenario, "marine"), 0, ctx.sc));
	const sw = waves(rngFor(ctx.seed, ctx.scenario, "swell"), 3, .25);
	return {
		lats,
		lons,
		times,
		hs: times.map((tm) => lats.map((la) => lons.map((lo) => {
			let s = 0;
			for (const dh of [
				0,
				3,
				6
			]) {
				const x = field(la, lo, tm - dh * H$1);
				s += Math.hypot(x.u, x.v);
			}
			const U = s / 3;
			const swell = ctx.sc.swell * (1 + waveSum(sw, la, lo, (tm - ctx.t0) / H$1));
			return Math.round(Math.max(.1, swell + .25 + WAVE_K * U * U) * 100) / 100;
		}))),
		fetchedAt,
		dummy: dummyTag(ctx)
	};
}
/**
* Les membres d'un ensemble, au format exact de `parseEnsemble` (+ `.download`,
* comme `fetchEnsembleGrids`). L'emprise arrondie VERS L'EXTÉRIEUR au pas,
* comme les vrais. Le membre 0 (le contrôle) reprend la perturbation du modèle
* déterministe ; les autres s'en écartent, l'écart grandissant avec l'échéance.
*/
function dummyEnsemble(model, { seed = DUMMY_DEFAULT.seed, scenario = DUMMY_DEFAULT.scenario, bbox, nowMs = Date.now(), step = 2, days = 10, isLand = null, members = null } = {}) {
	const E = DUMMY_ENSEMBLES[model];
	if (!E) return null;
	const t1 = Date.now();
	const ctx = dummyContext({
		seed,
		scenario,
		bbox,
		nowMs,
		isLand
	});
	const [w, s, e, n] = bbox;
	const { lats, lons } = dummyGridPoints([
		w,
		s,
		w + Math.ceil((e - w) / step) * step,
		s + Math.ceil((n - s) / step) * step
	], step);
	const times = dummyTimes(nowMs, days, Math.min(days * 24, E.horizonH));
	const M = DUMMY_MODELS[E.det] || DUMMY_MODELS.ecmwf_ifs025;
	const ctl = perturbation(rngFor(ctx.seed, ctx.scenario, "model", E.det), E.det === "ecmwf_ifs025" ? .35 : 1, ctx.sc);
	const N = Math.max(1, Math.min(E.members, members ?? E.members));
	const out = [];
	for (let k = 0; k < N; k++) {
		let pert = ctl;
		if (k > 0) {
			const d = perturbation(rngFor(ctx.seed, ctx.scenario, "ens", model, k), 1.25, ctx.sc);
			pert = {
				speed: clamp$1(ctl.speed * d.speed, .75, 1.25),
				dir: ctl.dir + d.dir,
				timeH: ctl.timeH + d.timeH * 1.5,
				dLat: ctl.dLat + d.dLat,
				dLon: ctl.dLon + d.dLon,
				noise: [...ctl.noise, ...d.noise]
			};
		}
		const g = windGrid(ctx, fieldOf(ctx, pert, { smooth: M.smooth }), {
			lats,
			lons,
			times,
			horizonH: E.horizonH,
			gust: false,
			extra: {
				model,
				member: k
			}
		});
		out.push(g);
	}
	out.download = {
		bytes: 0,
		ms: Date.now() - t1,
		cached: "dummy"
	};
	out.dummy = dummyTag(ctx);
	return out;
}
//#endregion
//#region scripts/routing/lib/weatherSource.mjs
var WEATHER_SOURCES = [
	"live",
	"previous",
	"dummy"
];
/** Une source propre : `'live'` · `'previous'` · `{ source: 'dummy', seed, scenario }` → { source, seed?, scenario? }. L'inconnu = live. */
function normalizeWeatherSource(x) {
	const o = typeof x === "string" ? { source: x } : x && typeof x === "object" ? x : {};
	const source = WEATHER_SOURCES.includes(o.source) ? o.source : "live";
	if (source === "dummy") return {
		source,
		seed: cleanSeed(o.seed ?? DUMMY_DEFAULT.seed),
		scenario: cleanScenario(o.scenario)
	};
	return { source };
}
function previousCap(ageH) {
	const a = Number(ageH);
	if (!Number.isFinite(a) || a <= 3) return null;
	return a <= 12 ? "moyenne" : "faible";
}
/**
* La météo d'un calcul selon sa source.
* io (node, injecté) = { fetchWindGrid, fetchWaveGrid, fetchEnsembleGrids, previousGrid, previousEnsembleGrids }.
* → { ws, grids, waves, models (ceux qu'on a), missing: { models, waves }, offline (aucun appel à Open-Meteo),
*     ensemble(model, bbox, { step, days }) → Promise<membres | null> }
*/
async function loadWeather(x, { bbox, nowMs = Date.now(), cacheDir = null, log = () => {}, isLand = null, models, onModel = () => {}, io = {} } = {}) {
	const ws = normalizeWeatherSource(x);
	const grids = {};
	const missing = {
		models: [],
		waves: false
	};
	if (ws.source === "dummy") {
		const D = dummyWeather({
			seed: ws.seed,
			scenario: ws.scenario,
			bbox,
			nowMs,
			step: 1,
			days: 10,
			isLand,
			models
		});
		Object.assign(grids, D.grids);
		onModel(models.length, models.length);
		log(`🧪 météo fictive — graine ${ws.seed}, scénario ${ws.scenario}`);
		return {
			ws,
			grids,
			waves: D.waves,
			models: models.filter((m) => grids[m]),
			missing,
			offline: true,
			ensemble: async (model, b, o = {}) => dummyEnsemble(model, {
				seed: ws.seed,
				scenario: ws.scenario,
				bbox: b,
				nowMs,
				step: o.step ?? 2,
				days: o.days ?? 10,
				isLand
			})
		};
	}
	if (ws.source === "previous") {
		const waves = io.previousGrid(cacheDir, "waves", bbox, 1, 10, nowMs);
		if (!waves) missing.waves = true;
		let n = 0;
		for (const m of models) {
			const g = io.previousGrid(cacheDir, `wind-${m}`, bbox, 1, 10, nowMs);
			if (g) grids[m] = g.model ? g : {
				...g,
				model: m
			};
			else missing.models.push(m);
			onModel(++n, models.length);
		}
		const ok = models.filter((m) => grids[m]);
		if (!ok.length) throw Object.assign(/* @__PURE__ */ new Error(`météo précédente : aucune grille en cache ne couvre cette zone (${bbox.join(", ")}) — calcule une fois « en direct »`), { code: "weather-none" });
		log(`🗄 météo précédente — ${ok.map((m) => `${m} ${grids[m].previous?.ageH ?? "?"} h`).join(", ")}${missing.models.length ? ` · manquent : ${missing.models.join(", ")}` : ""}${missing.waves ? " · pas de vagues" : ""}`);
		return {
			ws,
			grids,
			waves,
			models: ok,
			missing,
			offline: true,
			ensemble: async (model, b, o = {}) => io.previousEnsembleGrids(model, b, {
				step: o.step ?? 2,
				days: o.days ?? 10,
				cacheDir,
				nowMs
			})
		};
	}
	const waves = await io.fetchWaveGrid(bbox, {
		step: 1,
		days: 10,
		cacheDir,
		log
	});
	let n = 0;
	for (const m of models) {
		grids[m] = await io.fetchWindGrid(m, bbox, {
			step: 1,
			days: 10,
			cacheDir,
			log
		});
		onModel(++n, models.length);
	}
	return {
		ws,
		grids,
		waves,
		models,
		missing,
		offline: false,
		ensemble: null
	};
}
/** Ce que `result.weather` dit de la source (à fusionner avec weatherFreshness). Pur. */
function weatherSourceInfo(wx) {
	const ws = wx?.ws || { source: "live" };
	if (ws.source === "dummy") return {
		source: "dummy",
		seed: ws.seed,
		scenario: ws.scenario,
		dummyV: 1
	};
	if (ws.source === "previous") {
		const ages = Object.fromEntries(Object.entries(wx.grids || {}).map(([m, g]) => [m, g?.previous?.ageH ?? null]));
		const all = [...Object.values(ages), wx.waves?.previous?.ageH].filter((a) => Number.isFinite(a));
		const at = [...Object.values(wx.grids || {}).map((g) => g?.previous?.fetchedAt), wx.waves?.previous?.fetchedAt].filter(Boolean).sort();
		return {
			source: "previous",
			previous: {
				ages,
				wavesAgeH: wx.waves?.previous?.ageH ?? null,
				maxAgeH: all.length ? Math.max(...all) : null,
				minAgeH: all.length ? Math.min(...all) : null,
				fetchedAt: at[0] || null
			},
			missing: {
				models: wx.missing?.models || [],
				waves: Boolean(wx.missing?.waves)
			}
		};
	}
	return { source: "live" };
}
var LEVELS$3 = [
	"élevée",
	"moyenne",
	"faible"
];
/** Le premier élément de « À surveiller » d'un calcul qui n'est pas « en direct ». Pur. */
function weatherSourceWatch(w) {
	if (w?.source === "dummy") return {
		code: "weatherSource",
		level: "bad",
		source: "dummy",
		seed: w.seed,
		scenario: w.scenario
	};
	if (w?.source === "previous") {
		const p = w.previous || {};
		return {
			code: "weatherSource",
			level: previousCap(p.maxAgeH) === "faible" ? "bad" : "mid",
			source: "previous",
			ageH: p.maxAgeH,
			minAgeH: p.minAgeH,
			fetchedAt: p.fetchedAt,
			missing: w.missing?.models || [],
			wavesMissing: Boolean(w.missing?.waves)
		};
	}
	return null;
}
/**
* LE DRAPEAU, PARTOUT (pur, sur le résultat fini) — un calcul qui n'est pas
* « en direct » le dit : la confiance (« test » pour la météo fictive, la
* calculée gardée dans `computed` ; plafonnée par l'âge pour la précédente),
* la raison `weather-source` en tête, « À surveiller » en tête, chaque route
* (modèles, profils, optimiseur, ensembles, grille des départs) et le tableau
* des modèles. `pinnable: false` pour la fictive (l'app, le service et la 132).
*/
function applyWeatherSource(result) {
	const w = result?.weather;
	const src = w?.source;
	if (!result || !src || src === "live") return result;
	const c = result.confidence || {
		level: "faible",
		reasons: []
	};
	const cap = src === "previous" ? previousCap(w.previous?.maxAgeH) : null;
	if (src === "dummy") {
		result.confidence = {
			...c,
			computed: c.level,
			level: "test",
			reasons: [{
				code: "weather-source",
				level: "bad",
				source: "dummy",
				seed: w.seed,
				scenario: w.scenario
			}, ...c.reasons || []]
		};
		result.pinnable = false;
	} else {
		const p = w.previous || {};
		const reason = {
			code: "weather-source",
			level: cap === "faible" ? "bad" : cap === "moyenne" ? "mid" : "ok",
			source: "previous",
			ageH: p.maxAgeH,
			minAgeH: p.minAgeH,
			fetchedAt: p.fetchedAt,
			missing: w.missing?.models || [],
			wavesMissing: Boolean(w.missing?.waves)
		};
		const level = cap ? LEVELS$3[Math.max(LEVELS$3.indexOf(c.level), LEVELS$3.indexOf(cap))] : c.level;
		result.confidence = {
			...c,
			level,
			...cap ? { weather: cap } : {},
			reasons: [reason, ...c.reasons || []]
		};
	}
	const item = weatherSourceWatch(w);
	if (Array.isArray(result.watch) && item) result.watch.unshift(item);
	const tag = (model) => ({
		source: src,
		...src === "dummy" ? {
			seed: w.seed,
			scenario: w.scenario
		} : { ageH: w.previous?.ages?.[model] ?? null }
	});
	for (const [m, v] of Object.entries(result.models || {})) if (v) v.weather = {
		...v.weather || {},
		...tag(m)
	};
	for (const p of Object.values(result.profiles || {})) if (p) p.weather = {
		...p.weather || {},
		...tag(p.model)
	};
	if (result.optimiser) result.optimiser.weather = {
		...result.optimiser.weather || {},
		...tag(result.optimiser.model)
	};
	for (const [m, v] of Object.entries(result.forecast?.models || {})) if (v) Object.assign(v, tag(m));
	if (result.ensemble) result.ensemble.weather = {
		source: src,
		...src === "dummy" ? {
			seed: w.seed,
			scenario: w.scenario
		} : {}
	};
	if (result.bestDeparture) result.bestDeparture.weather = {
		source: src,
		...src === "dummy" ? {
			seed: w.seed,
			scenario: w.scenario
		} : { ageH: w.previous?.ages?.[result.bestDeparture.model] ?? null }
	};
	return result;
}
//#endregion
//#region scripts/routing/lib/zones.mjs
var memo = /* @__PURE__ */ new WeakMap();
/** rings : [[[lon, lat], …], …] → { crosses(a, b), inside(p), blocks(a, b) } | null. */
function exactZones(rings) {
	if (!Array.isArray(rings) || !rings.length) return null;
	if (memo.has(rings)) return memo.get(rings);
	const valid = rings.filter((r) => Array.isArray(r) && r.length > 3);
	if (!valid.length) {
		memo.set(rings, null);
		return null;
	}
	let w = Infinity;
	let s = Infinity;
	let e = -Infinity;
	let n = -Infinity;
	const boxes = valid.map((r) => {
		let x0 = Infinity;
		let y0 = Infinity;
		let x1 = -Infinity;
		let y1 = -Infinity;
		for (const [x, y] of r) {
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
		w = Math.min(w, x0);
		s = Math.min(s, y0);
		e = Math.max(e, x1);
		n = Math.max(n, y1);
		return [
			x0,
			y0,
			x1,
			y1
		];
	});
	const ix = buildCoastIndex(valid.map((r) => ({ geometry: {
		type: "Polygon",
		coordinates: [r]
	} })), [
		w - .1,
		s - .1,
		e + .1,
		n + .1
	], .05);
	const inside = (p) => valid.some((r, k) => {
		const b = boxes[k];
		return p.lon >= b[0] && p.lon <= b[2] && p.lat >= b[1] && p.lat <= b[3] && inPolygon(p.lat, p.lon, r);
	});
	const out = {
		crosses: (a, b) => ix.crosses(a, b),
		inside,
		blocks: (a, b) => inside(b) || ix.crosses(a, b)
	};
	memo.set(rings, out);
	return out;
}
//#endregion
//#region scripts/routing/lib/sailsRef.mjs
/**
* Une voile de la garde-robe.
* - `twa` : les angles au vent réel où la fiche la montre [min, max] (°).
* - `tws` : le vent réel où la fiche la montre, profil croisière [min, max] (nds).
* - `windNote` : la nuance que le graphique montre (le haut de la plage selon l'allure).
* - `race` : le haut de la plage « course » quand la fiche en trace une.
* - `bands` (grand-voile) : pleine puis 1 / 2 / 3 ris, chacune sa plage.
*/
var SAILS = [
	{
		id: "gv",
		kind: "main",
		logIds: [
			"haute",
			"ris1",
			"ris2",
			"ris3"
		],
		name: {
			fr: "Grand-voile",
			en: "Mainsail"
		},
		short: {
			fr: "GV",
			en: "Main"
		},
		model: {
			fr: "GV à corne, Hydra Net® radial",
			en: "Square-top main, Hydra Net® radial"
		},
		ref: "20731",
		cloth: "Hydra Net® radial",
		colour: {
			fr: "blanc, gris",
			en: "white, grey"
		},
		areaM2: 94,
		weightKg: 70,
		weightNote: {
			fr: "+ lattes",
			en: "+ battens"
		},
		battens: 6,
		reefs: 3,
		twa: [45, 180],
		tws: [0, 40],
		bands: [
			{
				id: "haute",
				label: {
					fr: "Pleine",
					en: "Full"
				},
				tws: [0, 20]
			},
			{
				id: "ris1",
				label: {
					fr: "1 ris",
					en: "1 reef"
				},
				tws: [17, 26]
			},
			{
				id: "ris2",
				label: {
					fr: "2 ris",
					en: "2 reefs"
				},
				tws: [23, 32]
			},
			{
				id: "ris3",
				label: {
					fr: "3 ris",
					en: "3 reefs"
				},
				tws: [28, 40]
			}
		],
		windNote: {
			fr: "pleine jusqu’à 19 nds au près, 20 nds au portant ; chaque ris un peu plus tôt au près qu’au portant",
			en: "full up to 19 kn upwind, 20 kn downwind; each reef a little earlier upwind than downwind"
		},
		race: null,
		handling: {
			fr: "à corne (square-top), 6 lattes, 3 bandes de ris",
			en: "square-top, 6 battens, 3 reefs"
		},
		dims: null,
		serial: null,
		sheet: "20731-gv-hydra-net.pdf"
	},
	{
		id: "genois",
		kind: "head",
		logIds: ["genois", "genois_roule"],
		name: {
			fr: "Génois",
			en: "Genoa"
		},
		short: {
			fr: "Génois",
			en: "Genoa"
		},
		model: {
			fr: "Génois Hydra Net® radial",
			en: "Genoa, Hydra Net® radial"
		},
		ref: "20735",
		cloth: "Hydra Net® radial",
		colour: {
			fr: "blanc, gris",
			en: "white, grey"
		},
		areaM2: 58,
		weightKg: 36,
		weightNote: null,
		battens: 0,
		reefs: null,
		twa: [45, 180],
		tws: [0, 26],
		bands: null,
		windNote: {
			fr: "jusqu’à 16 nds au près serré, 20 nds au travers, 26 nds vent arrière ; aux allures portantes, plutôt dans la brise (au-dessus de 5 nds à 110°, de 15 nds à 140°)",
			en: "up to 16 kn close-hauled, 20 kn on a beam reach, 26 kn dead downwind; downwind, rather in a breeze (above 5 kn at 110°, 15 kn at 140°)"
		},
		race: {
			fr: "jusqu’à ≈ 18 nds au près, 23 nds au travers",
			en: "up to ≈ 18 kn upwind, 23 kn on a beam reach"
		},
		handling: {
			fr: "sur enrouleur (« Génois roulé » dans Mes voiles)",
			en: "on a furler (“Furled genoa” in My sails)"
		},
		dims: null,
		serial: null,
		sheet: "20735-genois-hydra-net.pdf"
	},
	{
		id: "trinquette",
		kind: "head",
		logIds: ["trinquette", "solent"],
		name: {
			fr: "Trinquette",
			en: "Staysail"
		},
		short: {
			fr: "Trinquette",
			en: "Staysail"
		},
		model: {
			fr: "Trinquette Hydra Net® radial",
			en: "Staysail, Hydra Net® radial"
		},
		ref: "20742",
		cloth: "Hydra Net® radial",
		colour: {
			fr: "gris",
			en: "grey"
		},
		areaM2: 23,
		weightKg: 14,
		weightNote: null,
		battens: null,
		reefs: null,
		twa: [45, 180],
		tws: [16, 40],
		bands: null,
		windNote: {
			fr: "à partir de 16 nds au près serré (20 nds au travers, 26 nds vent arrière), jusqu’à 40 nds — elle prend le relais du génois",
			en: "from 16 kn close-hauled (20 kn on a beam reach, 26 kn dead downwind), up to 40 kn — it takes over from the genoa"
		},
		race: null,
		handling: null,
		dims: null,
		serial: null,
		sheet: "20742-trinquette-hydra-net.pdf"
	},
	{
		id: "gennaker",
		kind: "head",
		logIds: ["gennaker"],
		name: {
			fr: "Gennaker de descente",
			en: "Downwind gennaker"
		},
		short: {
			fr: "Gennaker",
			en: "Gennaker"
		},
		model: {
			fr: "Gennaker de descente, nylon",
			en: "Downwind gennaker, nylon"
		},
		ref: "20747",
		cloth: "Nylon 1.5 oz",
		colour: null,
		areaM2: 165,
		weightKg: 26,
		weightNote: null,
		battens: null,
		reefs: null,
		twa: [80, 150],
		tws: [0, 18],
		bands: null,
		windNote: {
			fr: "jusqu’à 7 nds à 80°, 12 nds au travers, 15 nds à 110°, 18 nds à 150°",
			en: "up to 7 kn at 80°, 12 kn on a beam reach, 15 kn at 110°, 18 kn at 150°"
		},
		race: {
			fr: "jusqu’à ≈ 22 nds à 150°",
			en: "up to ≈ 22 kn at 150°"
		},
		handling: {
			fr: "sur emmagasineur (on l’enroule, la nuit par exemple)",
			en: "on a furler (you roll it away, at night for instance)"
		},
		dims: null,
		serial: null,
		sheet: "20747-gennaker-de-descente-nylon.pdf"
	},
	{
		id: "spi",
		kind: "head",
		logIds: ["spi"],
		name: {
			fr: "Spi lourd S4",
			en: "Heavy spinnaker S4"
		},
		short: {
			fr: "Spi S4",
			en: "Spi S4"
		},
		model: {
			fr: "Spi symétrique lourd, Stormlite",
			en: "Heavy symmetric spinnaker, Stormlite"
		},
		ref: "21796",
		cloth: "Stormlite",
		colour: null,
		areaM2: 145,
		weightKg: 28,
		weightNote: {
			fr: "+ chaussette",
			en: "+ snuffer"
		},
		battens: null,
		reefs: null,
		twa: [130, 180],
		tws: [10, 23],
		bands: null,
		windNote: {
			fr: "à partir de 10 nds ; jusqu’à 16 nds à 140°, 20 nds à 150°, 23 nds vent arrière",
			en: "from 10 kn; up to 16 kn at 140°, 20 kn at 150°, 23 kn dead downwind"
		},
		race: {
			fr: "jusqu’à ≈ 29 nds vent arrière",
			en: "up to ≈ 29 kn dead downwind"
		},
		handling: {
			fr: "envoyé et affalé dans sa chaussette",
			en: "hoisted and doused in its snuffer"
		},
		dims: null,
		serial: null,
		sheet: "21796-spi-lourd-s4-stormlite.pdf"
	}
];
//#endregion
//#region scripts/routing/lib/polar.mjs
var TWS_BINS$1 = [
	4,
	6,
	8,
	10,
	12,
	14,
	16,
	20,
	25,
	30
];
var TWA_BINS$1 = [
	40,
	50,
	60,
	75,
	90,
	110,
	120,
	135,
	150,
	165,
	180
];
/**
* SAILS-002 (27 oct.) — LES PLAGES DES FICHES Incidence Sails (vent réel,
* profil croisière) : la seule source est src/data/sailsRef.js (`SAILS` —
* `tws`, `twa`, les bandes de ris) ; les plafonds qui DÉPENDENT DE L'ANGLE sont
* ceux que la fiche écrit en toutes lettres (`windNote`, recopiés ici et
* vérifiés contre ce texte par verify-polar-escale) :
*  · grande-voile : pleine ≤ 20, 1 ris ≤ 26, 2 ris ≤ 32, 3 ris → 40 nds (le haut
*    de chaque bande) ; un nœud plus tôt au près (« pleine jusqu'à 19 nds au
*    près, 20 au portant ») ;
*  · génois 0–26 nds : ≤ 16 au près serré, ≤ 20 au travers, ≤ 26 vent arrière ;
*    au-delà la trinquette (16–40) ;
*  · gennaker (nylon, 80–150°) : ≤ 7 nds à 80°, 12 au travers, 15 à 110°, 18 à 150° ;
*  · spi S4 (130–180°) : dès 10 nds ; ≤ 16 à 140°, 20 à 150°, 23 vent arrière.
*/
var SAIL = Object.fromEntries(SAILS.map((x) => [x.id, x]));
var bandTop = (id) => SAIL.gv.bands.find((b) => b.id === id).tws[1];
bandTop("haute"), bandTop("ris1"), bandTop("ris2"), SAIL.genois.tws[1], SAIL.gennaker.twa, SAIL.gennaker.tws[1], SAIL.spi.twa, SAIL.spi.tws[0], SAIL.spi.tws[1];
/** La vitesse surface (nœuds) pour une force et un angle, par interpolation bilinéaire. */
function boatSpeed(table, tws, twa) {
	const a = Math.min(180, Math.max(0, Math.abs(twa)));
	if (a < TWA_BINS$1[0] - 5) return 0;
	const w = Math.min(TWS_BINS$1[TWS_BINS$1.length - 1], Math.max(0, tws));
	const seg = (bins, v) => {
		if (v <= bins[0]) return [
			0,
			0,
			0
		];
		for (let i = 0; i < bins.length - 1; i++) if (v <= bins[i + 1]) return [
			i,
			i + 1,
			(v - bins[i]) / (bins[i + 1] - bins[i])
		];
		return [
			bins.length - 1,
			bins.length - 1,
			0
		];
	};
	const [i0, i1, ti] = seg(TWS_BINS$1, w);
	const [j0, j1, tj] = seg(TWA_BINS$1, Math.max(a, TWA_BINS$1[0]));
	const v00 = table[i0][j0];
	const v01 = table[i0][j1];
	const v10 = table[i1][j0];
	const v11 = table[i1][j1];
	let v = (v00 * (1 - tj) + v01 * tj) * (1 - ti) + (v10 * (1 - tj) + v11 * tj) * ti;
	if (w < TWS_BINS$1[0]) v *= w / TWS_BINS$1[0];
	return v;
}
//#endregion
//#region scripts/routing/lib/crew.mjs
var CREW_DEFAULTS = {
	crewN: 2,
	crewHardRunH: 6,
	crewNightH: 3,
	crewDecayPct: 2,
	crewDecayAfterH: 48,
	crewRested: 1
};
var CREW_BOUNDS = {
	crewN: [1, 8],
	crewHardRunH: [2, 24],
	crewNightH: [0, 12],
	crewDecayPct: [0, 10],
	crewDecayAfterH: [0, 120],
	crewRested: [0, 1]
};
/** Le rendement ne descend pas sous 85 % de la polaire. */
var CREW_DECAY_FLOOR = .85;
var RESTED_HARD_W = .5;
var num$2 = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
/** Les paramètres de l'équipage (défauts + réglages), et l'effet du nombre : à 4, la moitié de la fatigue. */
function crewOf(L = {}) {
	const c = {};
	for (const [k, [lo, hi]] of Object.entries(CREW_BOUNDS)) c[k] = Math.min(hi, Math.max(lo, num$2(L[k], CREW_DEFAULTS[k])));
	c.crewN = Math.round(c.crewN);
	c.crewRested = c.crewRested ? 1 : 0;
	const k = 2 / c.crewN;
	return {
		...c,
		runCapH: c.crewHardRunH / k,
		nightH: c.crewNightH * k,
		decayPerDay: c.crewDecayPct / 100 * k,
		decayAfterH: c.crewDecayAfterH
	};
}
/**
* Le rendement de l'équipage après `elapsedH` heures de mer (1 = frais). Sans
* réglage d'équipage (`P.crewDecayPct` absent : une route de bibliothèque, un
* essai) : 1 — les routes d'avant ne changent pas.
*/
function fatigueFactor(P, elapsedH) {
	if (!P || P.crewDecayPct == null || !(elapsedH > 0)) return 1;
	const c = P.crew || crewOf(P);
	const days = Math.max(0, elapsedH - c.decayAfterH) / 24;
	return Math.max(CREW_DECAY_FLOOR, 1 - c.decayPerDay * days);
}
/** Une heure dure : plus de 20 nds, ou du près à la voile dans du vent. */
var isUpwind = (p) => Boolean(p) && p.mode !== "moteur" && p.twa != null && p.twa < 70 && (p.tws ?? 0) >= 8;
var isHard = (p) => Boolean(p) && ((p.tws ?? 0) > 20 || isUpwind(p));
var nightAt = (isNight, p, t) => isNight ? isNight(p.lat, p.lon, t) : false;
/**
* LA FATIGUE LE LONG D'UNE ROUTE (pur). `points` : [{ t, lat, lon, twa, tws, mode }]
* (le point porte l'arête qui en part). `isNight(lat, lon, t)` (sun.mjs) ; `arrivalDay`
* (l'arrivée — à quai, attente comprise — de jour ?).
* → { runs: [{ kind: 'upwind'|'wind', startMs, endMs, h, night (n° de la nuit en mer, 1 = la 1ʳᵉ) | null }],
*     maxRunH, overH (heures au-delà du plafond d'affilée), hardH, lastHardH (dures dans les 12 dernières heures),
*     nights, decayPct (le rendement perdu à l'arrivée, %), restedH (le coût « arriver reposés »), score (heures équivalentes) }
*/
function fatigueAlong(points, L = {}, { isNight = null, arrivalDay = true, waitH = 0 } = {}) {
	const c = crewOf(L);
	const pts = Array.isArray(points) ? points.filter((p) => p && Number.isFinite(p.t)) : [];
	const out = {
		runs: [],
		maxRunH: 0,
		overH: 0,
		hardH: 0,
		lastHardH: 0,
		nights: 0,
		decayPct: 0,
		restedH: 0,
		score: 0,
		runCapH: Math.round(c.runCapH * 10) / 10
	};
	if (pts.length < 2) return out;
	const t0 = pts[0].t;
	const tEnd = pts.at(-1).t;
	const nightBuckets = /* @__PURE__ */ new Map();
	const nightIdx = (p, t) => Math.floor((t + p.lon / 15 * 36e5 - 12 * 36e5) / 864e5);
	let run = null;
	const close = () => {
		if (!run) return;
		run.h = Math.round(run.h * 10) / 10;
		if (run.h >= 1) out.runs.push(run);
		out.maxRunH = Math.max(out.maxRunH, run.h);
		run = null;
	};
	for (let i = 0; i < pts.length - 1; i++) {
		const a = pts[i];
		const b = pts[i + 1];
		const h = (b.t - a.t) / 36e5;
		if (!(h > 0)) continue;
		const mid = a.t + (b.t - a.t) / 2;
		const night = nightAt(isNight, a, mid);
		if (night) {
			const k = nightIdx(a, mid);
			nightBuckets.set(k, (nightBuckets.get(k) || 0) + h);
		}
		if (isHard(a)) {
			out.hardH += h;
			if (tEnd - mid <= 12 * 36e5) out.lastHardH += h;
			if (!run) run = {
				kind: "wind",
				startMs: a.t,
				endMs: b.t,
				h: 0,
				night: null,
				upH: 0
			};
			run.h += h;
			run.endMs = b.t;
			if (isUpwind(a)) run.upH += h;
			if (night && run.night == null) run.night = nightIdx(a, mid);
			const before = run.h - h;
			out.overH += Math.max(0, run.h - Math.max(c.runCapH, before));
		} else close();
	}
	close();
	const order = [...nightBuckets.entries()].filter(([, h]) => h >= 1).map(([k]) => k).sort((x, y) => x - y);
	out.nights = order.length;
	for (const r of out.runs) {
		r.kind = r.upH >= r.h / 2 ? "upwind" : "wind";
		delete r.upH;
		r.night = r.night == null ? null : order.indexOf(r.night) + 1 || null;
	}
	out.runs.sort((x, y) => y.h - x.h || x.startMs - y.startMs);
	const elapsedH = (tEnd - t0) / 36e5;
	out.decayPct = c.crewDecayPct > 0 ? Math.round((1 - fatigueFactor({
		crewDecayPct: c.crewDecayPct,
		crew: c
	}, elapsedH)) * 1e3) / 10 : 0;
	if (c.crewRested) out.restedH = (arrivalDay ? 0 : 3) + RESTED_HARD_W * out.lastHardH;
	const r1 = (x) => Math.round(x * 10) / 10;
	out.overH = r1(out.overH);
	out.hardH = r1(out.hardH);
	out.lastHardH = r1(out.lastHardH);
	out.restedH = r1(out.restedH);
	out.maxRunH = r1(out.maxRunH);
	out.score = r1(out.overH + c.nightH * out.nights + out.restedH);
	out.waitH = waitH || 0;
	return out;
}
/**
* « À surveiller » — la fatigue (pur) : la plus longue série dure au-delà du
* plafond (« 14 h de près d'affilée la 2ᵉ nuit »), une arrivée fatiguée (dures
* dans les 12 dernières heures, ou de nuit), et le rendement perdu sur une
* longue traversée. Des CODES, traduits dans l'app.
*/
function fatigueWatch(f, L = {}) {
	const c = crewOf(L);
	const w = [];
	if (!f) return w;
	const top = (f.runs || []).find((r) => r.h > c.runCapH);
	if (top) w.push({
		code: "fatigueRun",
		level: "mid",
		kind: top.kind,
		h: top.h,
		startMs: top.startMs,
		night: top.night,
		capH: Math.round(c.runCapH * 10) / 10,
		crewN: c.crewN
	});
	if (c.crewRested && f.lastHardH >= 3) w.push({
		code: "fatigueArrival",
		level: "mid",
		h: f.lastHardH
	});
	if (f.decayPct >= 2) w.push({
		code: "fatigueLong",
		level: "ok",
		pct: f.decayPct,
		afterH: c.decayAfterH,
		perDay: c.crewDecayPct,
		crewN: c.crewN
	});
	return w;
}
//#endregion
//#region scripts/routing/lib/engines.mjs
/** Instance NMEA 2000 (PGN 127488) → moteur. Observé le 29 oct. 2026 (voir plus haut). */
var ENGINE_BY_INSTANCE = Object.freeze({
	0: "stbd",
	1: "port"
});
Object.freeze({
	at: "2026-10-29T07:32",
	instance: 1,
	engine: "port",
	by: "B&C, via Flavien (29 oct. 2026)"
});
/** Les colonnes de `boat_telemetry` (migration 117) : une par instance. */
var ENGINE_COLUMN_BY_INSTANCE = Object.freeze({
	0: "engine_rpm",
	1: "engine2_rpm"
});
/** L'ordre d'affichage : bâbord à gauche, tribord à droite (comme à bord). */
var ENGINE_SIDES = Object.freeze(["port", "stbd"]);
/** Moteur → instance (dérivée de ENGINE_BY_INSTANCE, jamais écrite deux fois). */
var INSTANCE_OF = Object.freeze(Object.fromEntries(Object.entries(ENGINE_BY_INSTANCE).map(([i, side]) => [side, Number(i)])));
Object.freeze(Object.fromEntries(ENGINE_SIDES.map((s) => [s, ENGINE_COLUMN_BY_INSTANCE[INSTANCE_OF[s]]])));
Object.freeze([ENGINE_COLUMN_BY_INSTANCE[0], ENGINE_COLUMN_BY_INSTANCE[1]]);
Object.freeze({
	port: {
		fr: "bâbord",
		en: "port",
		abbr: {
			fr: "Bd",
			en: "P"
		},
		label: {
			fr: "Moteur bâbord",
			en: "Port engine"
		}
	},
	stbd: {
		fr: "tribord",
		en: "starboard",
		abbr: {
			fr: "Td",
			en: "S"
		},
		label: {
			fr: "Moteur tribord",
			en: "Starboard engine"
		}
	}
});
//#endregion
//#region scripts/routing/lib/propulsion.mjs
var RAD$3 = Math.PI / 180;
var PROPULSION_DEFAULTS = {
	motor: true,
	motorBelowKn: 4.5,
	motorKn: 6,
	fuelTankL: 550,
	fuelPct: 100,
	fuelLphPort: 2.54,
	fuelLphStbd: 2.72,
	engineMode: 0,
	fuelRpm: 1800,
	fuelReservePct: 20,
	efficiency: .95,
	minSailKn: .5,
	motorHeadwindFreeKn: 10,
	motorHeadwindLoss: .1,
	motorHeadSeaFreeM: 1,
	motorHeadSeaLoss: .5,
	motorUpwindMaxTws: 15,
	motorUpwindMaxWave: 2.5,
	motorMinKn: 2
};
/**
* La consommation retenue pour le BILAN (L/h), selon le réglage `engineMode` :
* bâbord, tribord, les deux, ou Auto = le mélange MESURÉ (heures bâbord ×
* bâbord + tribord × tribord + les deux × la somme) ÷ heures ; Auto sans
* assez de mesures = un moteur (la moyenne). → { lph, mode, source: 'bg'|'oneDefault'|'manual', usage? }
*/
var ENGINE_MODE_KEYS = [
	"auto",
	"port",
	"stbd",
	"both"
];
function fuelLphFor(p, usage = null) {
	const port = Number(p.fuelLphPort);
	const stbd = Number(p.fuelLphStbd);
	const r2 = (x) => Math.round(x * 100) / 100;
	const mode = ENGINE_MODE_KEYS[Math.round(Number(p.engineMode) || 0)] || "auto";
	if (mode === "port") return {
		lph: r2(port),
		mode,
		source: "manual"
	};
	if (mode === "stbd") return {
		lph: r2(stbd),
		mode,
		source: "manual"
	};
	if (mode === "both") return {
		lph: r2(port + stbd),
		mode,
		source: "manual"
	};
	const u = usage && Number(usage.totalH) >= 2 ? usage : null;
	if (!u) return {
		lph: r2((port + stbd) / 2),
		mode,
		source: "oneDefault"
	};
	return {
		lph: r2((u.portH * port + u.stbdH * stbd + u.bothH * (port + stbd)) / u.totalH),
		mode,
		source: "bg",
		usage: {
			portH: u.portH,
			stbdH: u.stbdH,
			bothH: u.bothH,
			totalH: u.totalH,
			oneShare: u.oneShare,
			fromMs: u.fromMs,
			toMs: u.toMs
		}
	};
}
/** Les paramètres de propulsion d'un jeu de limites (les défauts, puis les limites). */
var propulsionOf = (limits = {}) => {
	const P = {
		...PROPULSION_DEFAULTS,
		...limits
	};
	if (limits.crewDecayPct != null) P.crew = crewOf(limits);
	return P;
};
/**
* La vitesse au moteur (nœuds) au cap qui fait `twa` avec le vent réel `tws`,
* dans une mer `hs` (m, supposée venir du vent). 0° = vent de face.
*/
function motorSpeed(P, tws, twa, hs) {
	const head = Math.max(0, Math.cos(twa * RAD$3));
	const headwind = tws * head;
	return P.motorKn - P.motorHeadwindLoss * Math.max(0, headwind - P.motorHeadwindFreeKn) - P.motorHeadSeaLoss * Math.max(0, (hs ?? 0) - P.motorHeadSeaFreeM) * head;
}
/**
* Les façons d'avancer à ce cap, la plus rapide d'abord : [{ mode, speed }]
* (vide : on n'avance pas à ce cap). `minTwa` : l'angle minimal de la voile
* (50°, 60° dans une mer formée — les limites de B&C).
*/
function propulsionOptions(P, polar, { tws, twa, hs = null, minTwa, elapsedH = 0 }, policy = "crew") {
	const fat = P.crew && elapsedH > P.crew.decayAfterH ? fatigueFactor(P, elapsedH) : 1;
	const sail = twa < minTwa ? 0 : boatSpeed(polar, tws, twa) * P.efficiency * fat;
	if (sail >= P.motorBelowKn) return [{
		mode: "voile",
		speed: sail
	}];
	let motor = null;
	const hardUpwind = twa < minTwa && (tws > P.motorUpwindMaxTws || hs != null && hs >= P.motorUpwindMaxWave);
	if (P.motor && !hardUpwind) {
		const v = motorSpeed(P, tws, twa, hs);
		if (v >= P.motorMinKn) motor = v;
	}
	const canSail = sail >= P.minSailKn;
	if (policy === "choice") {
		const out = [];
		if (motor != null) out.push({
			mode: "moteur",
			speed: motor
		});
		if (canSail) out.push({
			mode: "voile",
			speed: sail
		});
		return out.sort((x, y) => y.speed - x.speed);
	}
	if (motor != null && motor >= sail) return [{
		mode: "moteur",
		speed: motor
	}];
	if (canSail) return [{
		mode: "voile",
		speed: sail
	}];
	return [];
}
/** La façon d'avancer de l'équipage (politique 'crew') : { mode, speed } ou null. */
function propel(P, polar, cond) {
	return propulsionOptions(P, polar, cond, "crew")[0] || null;
}
/** La plus grande vitesse possible (heuristique admissible de l'A*). */
function maxSpeedKn(P, polar) {
	let v = 0;
	for (const row of polar) for (const x of row) v = Math.max(v, x);
	return Math.max(v * P.efficiency, P.motor ? P.motorKn : 0);
}
//#endregion
//#region scripts/routing/lib/isochrone.mjs
var DEFAULT_LIMITS = {
	maxTws: 26,
	maxGust: 34,
	maxWave: 3,
	minTwa: 50,
	minTwaInSea: 60,
	seaWave: 2,
	coastNm: 3,
	coastFreeNm: 10,
	coastMinNm: .5,
	coastMinFreeNm: 1.5,
	motor: true,
	motorBelowKn: 4.5,
	motorKn: 6,
	efficiency: .95
};
/**
* opts = {
*   start, dest : { lat, lon },  departMs,
*   polar (table), wind(lat, lon, ms) → { tws, twd, gust } | null,
*   wave(lat, lon, ms) → m | null,
*   land : { isLand, segmentHitsLand },  forbidden : [ring [[lon, lat], …]],
*   limits, dtH = 1, headingStep = 5, maxHours = 168, coast, forbiddenMask, coastIndex
* }
* → { ok, reason?, arrivalMs, hours, distanceNm, points: [...], stats }
*/
function route(opts) {
	const L = {
		...DEFAULT_LIMITS,
		...opts.limits || {}
	};
	const P = propulsionOf(L);
	const { start, dest, departMs, polar, wind, wave, land, forbidden = [] } = opts;
	const dtH = opts.dtH ?? 1;
	const step = opts.headingStep ?? 5;
	const maxHours = opts.maxHours ?? 168;
	const startBrgToDest = bearing(start, dest);
	const voyage0 = opts.voyageStartMs ?? departMs;
	const clear = makeClear({
		start,
		dest,
		L,
		land,
		coast: opts.coast || null,
		coastFree: opts.coastFree === true,
		forbidden,
		forbiddenMask: opts.forbiddenMask || null,
		coastIndex: opts.coastIndex || null,
		zoneStepNm: opts.zoneStepNm ?? .4
	});
	let beyondForecast = false;
	const move = (p, heading, t) => {
		const w = wind(p.lat, p.lon, t);
		if (!w) {
			beyondForecast = true;
			return null;
		}
		if (w.tws > L.maxTws || w.gust != null && w.gust > L.maxGust) return null;
		const twa = twaAbs(heading, w.twd);
		const hs = wave ? wave(p.lat, p.lon, t) : null;
		const minTwa = hs != null && hs >= L.seaWave ? L.minTwaInSea : L.minTwa;
		const go = propel(P, polar, {
			tws: w.tws,
			twa,
			hs,
			minTwa,
			elapsedH: (t - voyage0) / 36e5
		});
		if (!go) return null;
		return {
			speed: go.speed,
			mode: go.mode,
			tws: w.tws,
			twd: w.twd,
			twa,
			gust: w.gust
		};
	};
	let iso = [{
		lat: start.lat,
		lon: start.lon,
		t: departMs,
		parent: null,
		d0: 0
	}];
	let best = null;
	const nSteps = Math.round(maxHours / dtH);
	for (let k = 0; k < nSteps && !best; k++) {
		const t = departMs + k * dtH * 36e5;
		const bySector = /* @__PURE__ */ new Map();
		let closest = null;
		for (const p of iso) {
			const dd = distNm(p, dest);
			const hd = bearing(p, dest);
			const mv0 = move(p, hd, t);
			if (mv0 && dd <= mv0.speed * dtH && clear(p, dest)) {
				const tArr = t + dd / mv0.speed * 36e5;
				if (!best || tArr < best.t) best = {
					lat: dest.lat,
					lon: dest.lon,
					t: tArr,
					parent: p,
					heading: hd,
					...mv0,
					d0: distNm(start, dest)
				};
				continue;
			}
			for (let h = 0; h < 360; h += step) {
				const mv = move(p, h, t);
				if (!mv) continue;
				const q = destination(p, h, mv.speed * dtH);
				if (!clear(p, q)) continue;
				if (wave) {
					const hs = wave(q.lat, q.lon, t + dtH * 36e5);
					if (hs != null && hs > L.maxWave) continue;
				}
				const d0 = distNm(start, q);
				const sec = Math.round((bearing(start, q) - startBrgToDest + 540) % 360 - 180);
				const prev = bySector.get(sec);
				const node = {
					lat: q.lat,
					lon: q.lon,
					t: t + dtH * 36e5,
					parent: p,
					heading: h,
					...mv,
					d0
				};
				const dq = distNm(q, dest);
				if (!closest || dq < closest.dq) closest = {
					node,
					dq,
					reach: mv.speed * dtH
				};
				if (!prev || d0 > prev.d0 + .05 || Math.abs(d0 - prev.d0) <= .05 && dq < distNm(prev, dest)) bySector.set(sec, node);
			}
		}
		if (best) break;
		iso = [...bySector.values()];
		if (closest && closest.dq <= 3 * closest.reach && !iso.includes(closest.node)) iso.push(closest.node);
		if (!iso.length) return beyondForecast ? {
			ok: false,
			short: true,
			reason: `prévision trop courte (${k * dtH} h) pour atteindre l'arrivée`
		} : {
			ok: false,
			reason: `aucune route dans les limites après ${k * dtH} h`
		};
	}
	if (!best) return {
		ok: false,
		short: true,
		reason: `pas d'arrivée en ${maxHours} h (prévision trop courte)`
	};
	const pts = [];
	for (let n = best; n; n = n.parent) pts.push(n);
	pts.reverse();
	const points = pts.map((n, i) => {
		const next = pts[i + 1];
		return {
			t: n.t,
			lat: n.lat,
			lon: n.lon,
			heading: next?.heading ?? n.heading ?? null,
			speed: next?.speed ?? n.speed ?? null,
			mode: next?.mode ?? n.mode ?? null,
			tws: next?.tws ?? n.tws ?? null,
			twd: next?.twd ?? n.twd ?? null,
			twa: next?.twa ?? n.twa ?? null,
			gust: next?.gust ?? n.gust ?? null,
			wave: wave ? wave(n.lat, n.lon, n.t) : null
		};
	});
	let distanceNm = 0;
	let motorH = 0;
	let upwindH = 0;
	let reachH = 0;
	let downH = 0;
	let maxTws = 0;
	let maxGust = null;
	let maxWave = 0;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		const h = (b.t - a.t) / 36e5;
		distanceNm += distNm(a, b);
		if (a.mode === "moteur") motorH += h;
		else if (a.twa < 60) upwindH += h;
		else if (a.twa < 120) reachH += h;
		else downH += h;
		maxTws = Math.max(maxTws, a.tws || 0);
		if (a.gust != null) maxGust = Math.max(maxGust ?? 0, a.gust);
		maxWave = Math.max(maxWave, a.wave || 0);
	}
	const hours = (best.t - departMs) / 36e5;
	return {
		ok: true,
		arrivalMs: best.t,
		hours,
		distanceNm,
		points,
		stats: {
			avgKn: distanceNm / hours,
			motorH,
			upwindH,
			reachH,
			downH,
			maxTws,
			maxGust,
			maxWave
		}
	};
}
/**
* LE CONTRÔLE DE SÉCURITÉ d'un segment a → b (pur) — le MÊME pour les deux
* moteurs (isochrones et graphe A*, 26 oct.) : zones interdites tramées le
* long du segment, côte exacte (aucune arête croisée ; dégagement minimal
* d'un demi-mille, levé dans le premier et le dernier mille et demi), marge à
* la côte (3 milles + petits fonds, levée près des bouts de la jambe et dans
* un détroit), terre au pas de 0,25 mille.
* ctx = { start, dest, L, land, coast?, coastFree?, forbidden?, forbiddenMask?, coastIndex?, zoneStepNm? (0,4) }
* → clear(a, b) : true si le segment est permis.
*/
function makeClear({ start, dest, L, land, coast = null, coastFree = false, forbidden = [], forbiddenMask = null, coastIndex = null, zoneStepNm = .4 }) {
	const freeNm = coastFree === true ? Infinity : L.coastFreeNm;
	const blocked = (p) => forbidden.some((ring) => inPolygon(p.lat, p.lon, ring));
	const zones = forbiddenMask;
	const exactZ = exactZones(forbidden);
	const exact = coastIndex;
	return (a, b) => {
		if (exactZ) {
			if (exactZ.blocks(a, b)) return false;
		} else if (zones ? zones.segmentHitsLand(a, b, zoneStepNm) : blocked(b)) return false;
		if (exact) {
			if (distNm(a, start) < L.coastMinFreeNm || distNm(b, dest) < L.coastMinFreeNm ? exact.crosses(a, b) : exact.near(a, b, L.coastMinNm)) return false;
		}
		if (coast && distNm(b, start) > freeNm && distNm(b, dest) > freeNm) return !coast.segmentHitsLand(a, b, .5);
		return !land.segmentHitsLand(a, b, .25);
	};
}
//#endregion
//#region scripts/routing/lib/pool.mjs
function createPool(file, workerData, size = Math.max(1, os.availableParallelism() - 1)) {
	const idle = [];
	const all = [];
	const queue = [];
	const pending = /* @__PURE__ */ new Map();
	let seq = 0;
	const pump = () => {
		while (idle.length && queue.length) {
			const w = idle.pop();
			const job = queue.shift();
			pending.set(job.id, job);
			w.postMessage({
				...job.msg,
				id: job.id
			});
		}
	};
	for (let i = 0; i < size; i++) {
		const w = new Worker$1(file, { workerData });
		w.on("message", ({ id, r, error }) => {
			const job = pending.get(id);
			pending.delete(id);
			idle.push(w);
			pump();
			if (error) job.ko(new Error(error));
			else job.ok(r);
		});
		w.on("error", (e) => {
			for (const job of pending.values()) job.ko(e);
			pending.clear();
		});
		all.push(w);
		idle.push(w);
	}
	return {
		size,
		run: (msg) => new Promise((ok, ko) => {
			queue.push({
				id: ++seq,
				msg,
				ok,
				ko
			});
			pump();
		}),
		close: () => Promise.all(all.map((w) => w.terminate()))
	};
}
//#endregion
//#region scripts/routing/lib/alongRoute.mjs
/** La position et le cap à l'instant t sur une route horodatée. */
function positionAt(timed, t) {
	for (let i = 0; i < timed.length - 1; i++) {
		const a = timed[i];
		const b = timed[i + 1];
		if (t >= a.t && t <= b.t) {
			const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
			const crs = bearing(a, b);
			return {
				...destination(a, crs, distNm(a, b) * f),
				course: crs
			};
		}
	}
	return null;
}
/** L'écart d'angles (°) : le plus grand écart à la moyenne circulaire. */
function angularSpread(degs) {
	if (degs.length < 2) return 0;
	const x = degs.reduce((s, d) => s + Math.cos(d * Math.PI / 180), 0);
	const y = degs.reduce((s, d) => s + Math.sin(d * Math.PI / 180), 0);
	const mean = Math.atan2(y, x) * 180 / Math.PI;
	return Math.max(...degs.map((d) => Math.abs((d - mean + 540) % 360 - 180)));
}
/**
* L'accord des modèles en un point : le vent faible varie beaucoup en
* direction sans conséquence, donc sous 8 nds on ne juge que la force.
* → 'accord' | 'partiel' | 'désaccord'
*/
function agreement(winds) {
	const ws = winds.filter(Boolean);
	if (ws.length < 2) return {
		level: "inconnu",
		twsSpread: 0,
		twdSpread: 0
	};
	const tws = ws.map((w) => w.tws);
	const twsSpread = Math.max(...tws) - Math.min(...tws);
	const twdSpread = Math.min(...tws) >= 8 ? angularSpread(ws.map((w) => w.twd)) : 0;
	return {
		level: twsSpread > 10 || twdSpread > 60 ? "désaccord" : twsSpread > 5 || twdSpread > 30 ? "partiel" : "accord",
		twsSpread,
		twdSpread
	};
}
/** Ce qui sort des limites de B&C en un point (une liste de courtes phrases). */
function flags({ winds, wave, course }, limits) {
	const f = [];
	const ws = winds.filter(Boolean);
	const maxTws = Math.max(0, ...ws.map((w) => w.tws));
	const gusts = ws.map((w) => w.gust).filter((g) => g != null);
	if (maxTws > limits.maxTws) f.push(`vent ${maxTws.toFixed(0)} nds`);
	if (gusts.length && Math.max(...gusts) > limits.maxGust) f.push(`rafales ${Math.max(...gusts).toFixed(0)} nds`);
	if (wave != null && wave > limits.maxWave) f.push(`vagues ${wave.toFixed(1)} m`);
	const tight = ws.filter((w) => w.tws >= 8 && twaAbs(course, w.twd) < (wave != null && wave >= limits.seaWave ? limits.minTwaInSea : limits.minTwa));
	if (tight.length && tight.length >= ws.length / 2) f.push("près serré");
	return f;
}
//#endregion
//#region scripts/routing/lib/extras.mjs
var ROUTE_WORKER = new URL("./routeWorker.mjs", import.meta.url);
var round1$1 = (x) => x == null ? null : Math.round(x * 10) / 10;
var LEVELS$2 = [
	"élevée",
	"moyenne",
	"faible"
];
/**
* Lance `jobs` ({ model, departMs, limits? }) sur un groupe de fils ; `grids` = les grilles utiles.
* D29 bis (29 oct.) — `ctx.createPool` : les fils de CET endroit (les Web Workers du navigateur, le
* fichier unique du PC du bord) ; sinon worker_threads (le service). Avant, `pool.mjs` en dur : la
* sensibilité à la polaire / à l'équipage ne pouvait pas tourner sur l'appareil.
*/
async function runJobs(ctx, grids, jobs, { limits = ctx.limits, threads = ctx.threads, onDone = () => {} } = {}) {
	const pool = (ctx.createPool || createPool)(ROUTE_WORKER, {
		polar: ctx.polar,
		grids,
		waves: ctx.waves,
		land: ctx.land.data,
		coast: ctx.coast.data,
		forbidden: ctx.forbidden,
		forbiddenMask: ctx.forbiddenMask.data,
		coastIndex: ctx.coastIndex?.data,
		limits
	}, Math.max(1, Math.min(jobs.length, threads)));
	try {
		let n = 0;
		return await Promise.all(jobs.map((j) => pool.run({
			model: j.model,
			stops: ctx.stops,
			departMs: j.departMs,
			...j.limits ? { limits: j.limits } : {}
		}).then((r) => {
			onDone(++n, jobs.length);
			return r;
		})));
	} finally {
		await pool.close();
	}
}
/**
* La sensibilité à la polaire : la référence refaite avec un rendement
* multiplié par chaque facteur (la base, 100 %, est le conseil lui-même).
* ⚠️ Moins vite à la voile, c'est aussi plus souvent au moteur (sous 4,5 nds) :
* l'arrivée recule moins que la vitesse ne baisse — c'est la réalité du bord.
*/
async function polarSensitivity(ctx, { factors = [.85, 1.1], base = null, onStep = () => {} } = {}) {
	const grids = { [ctx.refModel]: ctx.grids[ctx.refModel] };
	const jobs = factors.map((f) => ({
		model: ctx.refModel,
		departMs: ctx.departMs,
		limits: {
			...ctx.limits,
			efficiency: (ctx.limits.efficiency ?? .95) * f
		}
	}));
	const res = await runJobs(ctx, grids, jobs, {
		threads: Math.min(jobs.length, ctx.threads || 1),
		onDone: (done, total) => onStep({
			name: "polar",
			done,
			total
		})
	});
	const out = factors.map((f, i) => summarizeRoute$1(ctx, res[i], f));
	if (base) out.push(summarizeRoute$1(ctx, base, 1));
	return out.sort((a, b) => a.factor - b.factor);
}
function summarizeRoute$1(ctx, r, factor) {
	if (!r.ok) return {
		factor,
		ok: false,
		short: Boolean(r.short),
		reason: r.reason
	};
	return {
		factor,
		ok: true,
		arrivalMs: r.arrivalMs,
		hours: round1$1(r.hours),
		distanceNm: Math.round(r.distanceNm),
		motorH: round1$1(r.stats.motorH),
		maxTws: round1$1(r.stats.maxTws),
		maxGust: round1$1(r.stats.maxGust),
		maxWave: round1$1(r.stats.maxWave),
		day: arrivalLight(ctx.to.lat, ctx.to.lon, r.arrivalMs).day,
		...typeof ctx.bilan === "function" && Array.isArray(r.points) ? { bilan: ctx.bilan(r.points) } : {}
	};
}
/** Les deux hypothèses autour des réglages en vigueur (pur). */
function crewCases(limits = {}) {
	const pct = Number.isFinite(Number(limits.crewDecayPct)) ? Number(limits.crewDecayPct) : 2;
	const after = Number.isFinite(Number(limits.crewDecayAfterH)) ? Number(limits.crewDecayAfterH) : 48;
	return [{
		key: "rested",
		crewDecayPct: 0,
		crewDecayAfterH: after
	}, {
		key: "tired",
		crewDecayPct: Math.min(10, Math.max(4, pct * 2)),
		crewDecayAfterH: Math.min(after, 24)
	}];
}
async function crewSensitivity(ctx, { base = null, onStep = () => {} } = {}) {
	const grids = { [ctx.refModel]: ctx.grids[ctx.refModel] };
	const cases = crewCases(ctx.limits);
	const jobs = cases.map((c) => ({
		model: ctx.refModel,
		departMs: ctx.departMs,
		limits: {
			...ctx.limits,
			crewDecayPct: c.crewDecayPct,
			crewDecayAfterH: c.crewDecayAfterH
		}
	}));
	const res = await runJobs(ctx, grids, jobs, {
		threads: Math.min(jobs.length, ctx.threads || 1),
		onDone: (done, total) => onStep({
			name: "crew",
			done,
			total
		})
	});
	const out = cases.map((c, i) => ({
		key: c.key,
		decayPct: c.crewDecayPct,
		afterH: c.crewDecayAfterH,
		...summarizeRoute$1(ctx, res[i], 1)
	}));
	if (base) out.push({
		key: "base",
		decayPct: Number(ctx.limits.crewDecayPct ?? 2),
		afterH: Number(ctx.limits.crewDecayAfterH ?? 48),
		...summarizeRoute$1(ctx, base, 1)
	});
	const order = {
		rested: 0,
		base: 1,
		tired: 2
	};
	return out.map(({ factor: _factor, ...x }) => x).sort((a, b) => order[a.key] - order[b.key]);
}
/** Le meilleur départ : toutes les 3 h sur `spanH`, tous les modèles. ✓ = tous (3 au moins) dans les limites, arrivée médiane de jour, confiance pas faible. */
async function departurePlan(ctx, { spanH = 48, stepH = 3, onStep = () => {} } = {}) {
	const models = Object.keys(ctx.grids);
	const deps = [];
	for (let d = ctx.departMs; d <= ctx.departMs + spanH * 36e5; d += stepH * 36e5) deps.push(d);
	const jobs = deps.flatMap((departMs) => models.map((model) => ({
		model,
		departMs
	})));
	const res = await runJobs(ctx, ctx.grids, jobs, { onDone: (done, total) => onStep({
		name: "departures",
		done,
		total
	}) });
	return deps.map((dep, k) => {
		const R = Object.fromEntries(models.map((m, i) => [m, res[k * models.length + i]]));
		const ok = models.filter((m) => R[m].ok);
		const short = models.filter((m) => !R[m].ok && R[m].short);
		const etas = ok.map((m) => R[m].arrivalMs).sort((a, b) => a - b);
		const medianEta = etas.length ? etas[Math.floor((etas.length - 1) / 2)] : null;
		const spreadH = etas.length > 1 ? (etas.at(-1) - etas[0]) / 36e5 : 0;
		let lateral = 0;
		for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
			const a = R[ok[i]].points;
			const b = R[ok[j]].points;
			for (let t = dep; t <= Math.min(R[ok[i]].arrivalMs, R[ok[j]].arrivalMs); t += 6 * 36e5) lateral = Math.max(lateral, distNm(pointAt(a, t), pointAt(b, t)));
		}
		const conf = ok.length < 2 ? "faible" : spreadH > 18 || lateral > 150 ? "faible" : spreadH > 6 || lateral > 60 ? "moyenne" : "élevée";
		const light = medianEta ? arrivalLight(ctx.to.lat, ctx.to.lon, medianEta) : null;
		const judged = models.length - short.length;
		return {
			dep,
			medianEta,
			light: light ? {
				day: light.day,
				waitH: round1$1(light.waitH)
			} : null,
			okN: ok.length,
			models: judged,
			spreadH: round1$1(spreadH),
			lateralNm: Math.round(lateral),
			conf,
			maxTws: ok.length ? round1$1(Math.max(...ok.map((m) => R[m].stats.maxTws))) : null,
			maxWave: ok.length ? round1$1(Math.max(...ok.map((m) => R[m].stats.maxWave))) : null,
			motorH: ok.length ? round1$1(percentile(ok.map((m) => R[m].stats.motorH), .5)) : null,
			good: ok.length === judged && ok.length >= 3 && Boolean(light?.day) && conf !== "faible"
		};
	});
}
function pointAt(points, t) {
	if (t <= points[0].t) return points[0];
	for (let i = 0; i < points.length - 1; i++) if (t <= points[i + 1].t) {
		const f = (t - points[i].t) / (points[i + 1].t - points[i].t);
		return {
			lat: points[i].lat + (points[i + 1].lat - points[i].lat) * f,
			lon: points[i].lon + (points[i + 1].lon - points[i].lon) * f
		};
	}
	return points.at(-1);
}
/**
* Les ensembles : chaque membre routé, une PART des membres par fil (173
* grilles copiées dans chaque fil = 6 Go mesurés ; une part chacun = 2 Go).
* → { all, byModel, hist, median: { model, member, line }, download }
*/
async function ensembleRun(ctx, { models: asked = Object.keys(ENSEMBLES), onStep = () => {} } = {}) {
	const grids = {};
	let bytes = 0;
	const missing = [];
	const ages = {};
	for (const m of asked) {
		const list = ctx.fetchEnsemble ? await ctx.fetchEnsemble(m, ctx.bbox, {
			step: 2,
			days: 10
		}) : await fetchEnsembleGrids(m, ctx.bbox, {
			step: 2,
			days: 10,
			cacheDir: ctx.cacheDir,
			log: ctx.log
		});
		if (!list?.length) missing.push(m);
		else {
			for (const g of list) grids[`${m}#${String(g.member).padStart(2, "0")}`] = g;
			bytes += list.download?.bytes || 0;
			if (list.previous) ages[m] = list.previous.ageH;
		}
		onStep({
			name: "ensembles-weather",
			done: asked.indexOf(m) + 1,
			total: asked.length
		});
	}
	const models = asked.filter((m) => !missing.includes(m));
	if (!models.length) throw Object.assign(/* @__PURE__ */ new Error(`ensembles : aucun en cache pour cette zone (${missing.join(", ")})`), { code: "ensemble-none" });
	const keys = Object.keys(grids);
	const threads = Math.max(1, Math.min(keys.length, ctx.threads));
	const parts = Array.from({ length: threads }, (_, p) => keys.filter((_k, i) => i % threads === p));
	const done = new Array(keys.length);
	let n = 0;
	await Promise.all(parts.map(async (part, p) => {
		const out = await runJobs(ctx, Object.fromEntries(part.map((k) => [k, grids[k]])), part.map((k) => ({
			model: k,
			departMs: ctx.departMs
		})), {
			threads: 1,
			onDone: () => onStep({
				name: "ensembles",
				done: ++n,
				total: keys.length
			})
		});
		part.forEach((_k, j) => {
			done[j * threads + p] = out[j];
		});
	}));
	const members = keys.map((k, i) => {
		const [model, num] = k.split("#");
		return {
			key: k,
			model,
			member: Number(num),
			...done[i]
		};
	});
	const sum = (list) => {
		const ok = list.filter((r) => r.ok);
		const arr = ok.map((r) => r.arrivalMs);
		const blocked = list.filter((r) => !r.ok && !r.short).length;
		const short = list.filter((r) => !r.ok && r.short).length;
		const c = ensembleConfidence({
			arrivals: arr,
			blocked,
			short
		});
		return {
			n: list.length,
			routed: ok.length,
			blocked,
			short,
			p10: percentile(arr, .1),
			p50: percentile(arr, .5),
			p90: percentile(arr, .9),
			daylight: daylightShare(arr, ctx.to),
			maxTwsP90: round1$1(percentile(ok.map((r) => r.stats.maxTws), .9)),
			motorHMed: round1$1(percentile(ok.map((r) => r.stats.motorH), .5)),
			confidence: {
				level: c.level,
				widthH: round1$1(c.widthH),
				blockedShare: c.blockedShare == null ? null : Math.round(c.blockedShare * 100) / 100
			}
		};
	};
	const all = sum(members);
	const arrivals = members.filter((r) => r.ok).map((r) => ({
		t: r.arrivalMs,
		model: r.model
	}));
	const hist = arrivalBins(arrivals, { binH: binHoursFor(arrivals.length ? (Math.max(...arrivals.map((a) => a.t)) - Math.min(...arrivals.map((a) => a.t))) / 36e5 : 0) });
	const med = medianMember(members);
	return {
		models: Object.fromEntries(models.map((m) => [m, {
			label: ENSEMBLES[m].label,
			...sum(members.filter((r) => r.model === m))
		}])),
		all,
		hist: {
			binMs: hist.binMs,
			start: hist.start,
			bins: hist.bins.map((b) => ({
				t0: b.t0,
				n: b.n,
				by: b.by
			}))
		},
		median: med ? {
			model: med.model,
			member: med.member,
			line: med.points.map((p) => [
				Math.round(p.lon * 1e4) / 1e4,
				Math.round(p.lat * 1e4) / 1e4,
				p.t
			])
		} : null,
		download: { bytes },
		members: members.length,
		...missing.length ? { missing } : {},
		...Object.keys(ages).length ? { ages } : {}
	};
}
/**
* La confiance unique (D11) avec les options : la plus basse des niveaux
* connus ; l'ensemble ajoute sa raison (largeur P10–P90, part bloquée). Pur.
*/
function withEnsembleConfidence(confidence, ens) {
	if (!ens?.all?.confidence) return confidence;
	const e = ens.all.confidence;
	const level = LEVELS$2[Math.max(LEVELS$2.indexOf(confidence.level), LEVELS$2.indexOf(e.level))];
	const reasons = [...confidence.reasons, {
		code: "ensemble",
		level: e.level === "élevée" ? "ok" : e.level === "moyenne" ? "mid" : "bad",
		widthH: e.widthH,
		blockedShare: e.blockedShare,
		members: ens.members
	}];
	return {
		...confidence,
		level,
		ensemble: e.level,
		reasons
	};
}
//#endregion
//#region scripts/routing/lib/polarUncertainty.mjs
var POLAR_UNCERT_MODES = [
	"none",
	"prudent",
	"range",
	"cells"
];
/** Le côté pessimiste de chaque sorte de case (%). */
var POLAR_CELL_PCT = {
	measured: 5,
	blended: 10,
	escale: 20
};
var POLAR_UNCERT_DEFAULTS = {
	polarUncert: 3,
	polarUncertPct: 10,
	polarMinPct: 85,
	polarMaxPct: 110
};
var POLAR_UNCERT_BOUNDS = {
	polarUncert: [0, 3],
	polarUncertPct: [0, 40],
	polarMinPct: [50, 100],
	polarMaxPct: [100, 150]
};
var n = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
/** Le réglage lu (défauts + bornes). */
function uncertaintyOf(L = {}) {
	const o = {};
	for (const [k, [lo, hi]] of Object.entries(POLAR_UNCERT_BOUNDS)) o[k] = Math.min(hi, Math.max(lo, n(L[k], POLAR_UNCERT_DEFAULTS[k])));
	o.polarUncert = Math.round(o.polarUncert);
	return {
		...o,
		mode: POLAR_UNCERT_MODES[o.polarUncert] || "cells"
	};
}
/**
* La table de la polaire pour la route (pur). `P` = polar-wangap.json (ou
* `{ mixed: { table }, calibration? }`). Sans confiance par case (une polaire
* d'avant POLAR-001), « selon les cases » prend −10 % partout, et le dit.
* → { table, mode, factor: { min, max } (les facteurs appliqués), cellsKnown, sensitivity: [min, max] }
*/
function polarForRoute(P, L = {}) {
	const u = uncertaintyOf(L);
	const base = P?.mixed?.table || P?.table || P;
	const conf = P?.calibration?.confidence || null;
	const sens = [u.polarMinPct / 100, u.polarMaxPct / 100];
	const scale = (f) => base.map((row) => row.map((x) => Math.round(x * f * 1e3) / 1e3));
	if (u.mode === "none" || u.mode === "range") return {
		table: base,
		mode: u.mode,
		factor: {
			min: 1,
			max: 1
		},
		cellsKnown: Boolean(conf),
		sensitivity: sens
	};
	if (u.mode === "prudent") {
		const f = 1 - u.polarUncertPct / 100;
		return {
			table: scale(f),
			mode: u.mode,
			factor: {
				min: f,
				max: f
			},
			cellsKnown: Boolean(conf),
			sensitivity: sens
		};
	}
	if (!conf) return {
		table: scale(1 - POLAR_CELL_PCT.blended / 100),
		mode: u.mode,
		factor: {
			min: .9,
			max: .9
		},
		cellsKnown: false,
		sensitivity: sens
	};
	let lo = 1;
	let hi = 0;
	return {
		table: base.map((row, i) => row.map((x, j) => {
			const f = 1 - (POLAR_CELL_PCT[conf[i]?.[j]] ?? POLAR_CELL_PCT.escale) / 100;
			lo = Math.min(lo, f);
			hi = Math.max(hi, f);
			return Math.round(x * f * 1e3) / 1e3;
		})),
		mode: u.mode,
		factor: {
			min: lo,
			max: hi
		},
		cellsKnown: true,
		sensitivity: sens
	};
}
var nearest = (bins, v) => {
	let b = 0;
	for (let i = 1; i < bins.length; i++) if (Math.abs(bins[i] - v) < Math.abs(bins[b] - v)) b = i;
	return b;
};
/**
* Les heures À LA VOILE d'une route par sorte de case (pur) — « sur quelles
* cases la route repose-t-elle ? ». `points` : [{ t, tws, twa, mode }] (le point
* porte l'arête qui en part). → { sailH, measuredH, blendedH, escaleH, escaleShare,
* spans: [{ fromMs, toMs, h }] (les tranches ≥ 3 h sur des cases « Escale seule ») }
*/
function polarCellsAlong(points, P) {
	const conf = P?.calibration?.confidence;
	const tws = P?.TWS_BINS;
	const twa = P?.TWA_BINS;
	const out = {
		sailH: 0,
		measuredH: 0,
		blendedH: 0,
		escaleH: 0,
		escaleShare: 0,
		spans: [],
		known: Boolean(conf && tws && twa)
	};
	if (!out.known || !Array.isArray(points)) return out;
	let span = null;
	const close = () => {
		if (span && span.h >= 3) out.spans.push({
			...span,
			h: Math.round(span.h * 10) / 10
		});
		span = null;
	};
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		const h = (b.t - a.t) / 36e5;
		if (!(h > 0) || a.mode === "moteur" || a.tws == null || a.twa == null) {
			close();
			continue;
		}
		const c = conf[nearest(tws, a.tws)]?.[nearest(twa, a.twa)] || "escale";
		out.sailH += h;
		if (c === "measured") out.measuredH += h;
		else if (c === "blended") out.blendedH += h;
		else out.escaleH += h;
		if (c === "escale") {
			if (!span) span = {
				fromMs: a.t,
				toMs: b.t,
				h: 0
			};
			span.toMs = b.t;
			span.h += h;
		} else close();
	}
	close();
	const r1 = (x) => Math.round(x * 10) / 10;
	for (const k of [
		"sailH",
		"measuredH",
		"blendedH",
		"escaleH"
	]) out[k] = r1(out[k]);
	out.escaleShare = out.sailH > 0 ? Math.round(out.escaleH / out.sailH * 100) / 100 : 0;
	out.spans = out.spans.sort((x, y) => y.h - x.h).slice(0, 3);
	return out;
}
/** La raison « polaire » (pur) : dite, sans baisser la confiance (c'est le bateau, pas la météo). */
function polarReason(cells, mode) {
	if (!cells?.known || !(cells.sailH > 0)) return null;
	return {
		code: "polar",
		level: cells.escaleShare > .4 ? "mid" : "ok",
		info: true,
		mode,
		escaleH: cells.escaleH,
		sailH: cells.sailH,
		share: cells.escaleShare
	};
}
var SCORE_CRITERIA = [
	"temps",
	"confort",
	"voile",
	"marge",
	"jour",
	"certitude"
];
/** Les poids par défaut (sur 100) de chaque objectif — § 3.10. ✏️ Personnalisé : les siens (`custom.weights`), sinon ceux du préréglage qui lui ressemble. */
var SCORE_WEIGHTS = {
	prudent: {
		temps: 10,
		confort: 20,
		voile: 0,
		marge: 35,
		jour: 25,
		certitude: 10
	},
	confort: {
		temps: 15,
		confort: 45,
		voile: 0,
		marge: 20,
		jour: 20,
		certitude: 0
	},
	voile: {
		temps: 20,
		confort: 15,
		voile: 50,
		marge: 15,
		jour: 0,
		certitude: 0
	},
	rapide: {
		temps: 60,
		confort: 10,
		voile: 0,
		marge: 20,
		jour: 10,
		certitude: 0
	}
};
var SCORE_K = {
	tempsPerPct: 2,
	confortPerPct: 2,
	marginPct: 80,
	margeMinSpan: 10,
	jourPerWaitH: 6,
	jourFloor: 25,
	certitude: {
		"élevée": 100,
		moyenne: 60,
		faible: 30
	},
	redRatio: .9,
	nightH: 3
};
var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
var num$1 = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
/**
* Des poids propres (pur) : les six critères, chacun borné à 0–100 (arrondi),
* un critère absent ou illisible vaut 0 ; null si ce n'est pas un objet ou si
* la somme est nulle. C'est la validation de `custom.weights` (prefs.mjs et
* src/lib/routage.js `cleanCustom`).
*/
function cleanWeights(w) {
	if (!w || typeof w !== "object" || Array.isArray(w)) return null;
	const out = {};
	let sum = 0;
	for (const k of SCORE_CRITERIA) {
		const n = Number(w[k]);
		out[k] = Number.isFinite(n) ? Math.round(clamp(n, 0, 100)) : 0;
		sum += out[k];
	}
	return sum > 0 ? out : null;
}
/** Le préréglage qui ressemble à un ordre de priorités : son PREMIER critère (= `scoreKindFor` de departures.mjs). */
function presetForOrder(order = []) {
	for (const it of Array.isArray(order) ? order : []) {
		if (it === "margin" || it === "day") return "prudent";
		if (it === "comfort") return "confort";
		if (it === "motor" || it === "sail") return "voile";
		if (it === "fast") return "rapide";
	}
	return "prudent";
}
/** Les poids d'un objectif : un préréglage → les siens ; « perso » → `customWeights` (validés), sinon ceux du préréglage de son ordre. */
function weightsFor(objective, { customWeights = null, order = null } = {}) {
	if (SCORE_WEIGHTS[objective]) return { ...SCORE_WEIGHTS[objective] };
	return cleanWeights(customWeights) || { ...SCORE_WEIGHTS[presetForOrder(order)] };
}
/** Décision (3) : « arriver de jour » filtre la ★ du score quand `day` est dans les priorités de l'objectif. */
var dayFilterFor = (order) => Array.isArray(order) && order.includes("day");
/** Les heures « dures » du confort (cellScore, departures.mjs) : > 20 nds + mer > 2 m + ½ près + nuits × crewNightH + fatigue. null si un terme manque. */
function hardHours(c, crewNightH = SCORE_K.nightH) {
	const f = c && (c.fatigue || c.fat);
	const xs = [
		c && c.h20,
		c && c.hWave2,
		c && c.upwindH,
		c && c.nights,
		f && f.overH,
		f && f.restedH
	].map(num$1);
	if (xs.some((x) => x == null)) return null;
	const [h20, hW, up, nights, over, rested] = xs;
	return h20 + hW + .5 * up + crewNightH * nights + over + rested;
}
/** Les heures EN MER d'une case (l'attente au large exclue — décision 5). */
function seaHours(c) {
	if (!c) return null;
	if (num$1(c.arrivalMs) != null && num$1(c.dep) != null) return (c.arrivalMs - c.dep) / 36e5;
	const h = num$1(c.hours);
	return h == null ? null : h - (num$1(c.waitH) || 0);
}
/** Pourquoi une case n'a pas de score : 'noroute' · 'limits' (≥ 90 % des limites) · 'fuel' (réserve entamée) — ou null (elle en a un). */
function unscoredWhy(c) {
	if (!c || !c.ok) return "noroute";
	if (num$1(c.limitRatio) != null && c.limitRatio >= SCORE_K.redRatio - 1e-9 || c.cls === "red" && c.why !== "fuel") return "limits";
	if (c.intoReserve || c.why === "fuel") return "fuel";
	return null;
}
/** Une case notée ? (une route, ni rouge ni réserve entamée — l'ambre et le gris « de nuit » sont notés). */
var scorable = (c) => unscoredWhy(c) == null;
/**
* Le contexte d'un calcul (pur) : la case la plus COURTE EN MER parmi toutes
* les cases notées de toutes les lignes ; les heures d'une nuit ; la marge de B&C.
* cellsByRow : { ligne: [case] } (`bestDeparture.cells`).
*/
function scoreContext(cellsByRow, { crewNightH = SCORE_K.nightH, marginPct = SCORE_K.marginPct } = {}) {
	let fastestSeaH = null;
	for (const row of Object.values(cellsByRow || {})) for (const c of row || []) {
		const h = scorable(c) ? seaHours(c) : null;
		if (h > 0) fastestSeaH = fastestSeaH == null ? h : Math.min(fastestSeaH, h);
	}
	return {
		v: 1,
		fastestSeaH,
		crewNightH: num$1(crewNightH) ?? SCORE_K.nightH,
		marginPct: num$1(marginPct) ?? SCORE_K.marginPct
	};
}
/** Les six critères d'une case, 0–100 chacun (null = inconnu). */
function criteria(c, ctx) {
	const K = SCORE_K;
	const sea = seaHours(c);
	const hours = num$1(c.hours);
	const hard = hardHours(c, ctx.crewNightH);
	const span = Math.max(K.margeMinSpan, 2 * (100 - (num$1(ctx.marginPct) ?? K.marginPct)));
	const level = c.agree && typeof c.agree === "object" ? c.agree.level : c.agree;
	return {
		temps: sea > 0 && ctx.fastestSeaH > 0 ? clamp(100 - K.tempsPerPct * ((sea - ctx.fastestSeaH) / ctx.fastestSeaH) * 100, 0, 100) : null,
		confort: hard != null && hours > 0 ? clamp(100 - K.confortPerPct * (hard / hours) * 100, 0, 100) : null,
		voile: num$1(c.sailPct) != null ? clamp(c.sailPct, 0, 100) : null,
		marge: num$1(c.marginPct) != null ? clamp(100 * c.marginPct / span, 0, 100) : null,
		jour: c.day == null ? null : !c.day ? 0 : Math.max(K.jourFloor, 100 - K.jourPerWaitH * (num$1(c.waitH) || 0)),
		certitude: K.certitude[level] ?? null
	};
}
/**
* Le score d'une case. weights : { critère: poids ≥ 0 } (somme quelconque, ramenée à 100).
* → { ok: false, why: 'noroute' | 'limits' | 'fuel' | 'noweights' }
*   | { ok: true, score, parts: [{ k, w, crit, pts }], missing: [k], renorm, seaH, waitH, quayMs }
*   w = la part du poids (sur 100), pts = la contribution (sur w) ; Σ pts = score.
*   seaH = les heures en mer (le Temps), waitH = l'attente au large, quayMs = l'heure à quai (à dire).
*/
function scoreCell(c, weights, ctx) {
	const why = unscoredWhy(c);
	if (why) return {
		ok: false,
		why
	};
	const W = weights || {};
	const cr = criteria(c, ctx);
	const missing = SCORE_CRITERIA.filter((k) => (W[k] || 0) > 0 && cr[k] == null);
	const sumW = SCORE_CRITERIA.reduce((a, k) => a + (cr[k] != null ? Math.max(0, W[k] || 0) : 0), 0);
	if (!(sumW > 0)) return {
		ok: false,
		why: "noweights"
	};
	const parts = SCORE_CRITERIA.map((k) => {
		const w = cr[k] != null ? 100 * Math.max(0, W[k] || 0) / sumW : 0;
		return {
			k,
			w,
			crit: cr[k],
			pts: cr[k] != null ? w * cr[k] / 100 : null
		};
	});
	return {
		ok: true,
		score: parts.reduce((a, p) => a + (p.pts || 0), 0),
		parts,
		missing,
		renorm: missing.length > 0,
		seaH: seaHours(c),
		waitH: num$1(c.waitH) || 0,
		quayMs: num$1(c.dayArrivalMs) ?? num$1(c.arrivalMs)
	};
}
var lexLess$1 = (a, b) => {
	if (!Array.isArray(a) || !Array.isArray(b)) return false;
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x < y - 1e-9) return true;
		if (x > y + 1e-9) return false;
	}
	return false;
};
var quayOf = (c) => num$1(c.dayArrivalMs) ?? num$1(c.arrivalMs) ?? Infinity;
/**
* La ★ du score d'une ligne (pur) → l'indice de la case, ou null.
* Le plus grand score parmi les cases notées ; `dayFilter` (décision 3) : les
* cases de jour seulement, sinon (aucune de jour) parmi toutes les notées.
* À score égal : l'ordre des priorités du moteur (`rank`), puis l'heure à quai la plus tôt.
*/
function bestByScore(row, weights, ctx, { dayFilter = false } = {}) {
	const scored = (row || []).map((c, i) => ({
		c,
		i,
		s: scoreCell(c, weights, ctx)
	})).filter((x) => x.s.ok);
	const pool = dayFilter && scored.some((x) => x.c.day) ? scored.filter((x) => x.c.day) : scored;
	let best = null;
	for (const x of pool) {
		if (!best || x.s.score > best.s.score + 1e-9) {
			best = x;
			continue;
		}
		if (Math.abs(x.s.score - best.s.score) <= 1e-9 && (lexLess$1(x.c.rank, best.c.rank) || !lexLess$1(best.c.rank, x.c.rank) && quayOf(x.c) < quayOf(best.c))) best = x;
	}
	return best ? best.i : null;
}
//#endregion
//#region scripts/routing/lib/prefs.mjs
/** Les éléments de l'ordre des priorités (les limites de B&C, D5, restent un plancher 🔒 hors liste). */
var PRIORITY_ITEMS = [
	"margin",
	"day",
	"comfort",
	"fast",
	"motor",
	"sail"
];
/** Les préréglages (D18 : Rapide · Confort · Prudent · Voile ; ROUTAGE_OPTIMISEURS §3.2). */
var PRESETS = {
	prudent: [
		"margin",
		"day",
		"comfort",
		"fast"
	],
	confort: ["comfort", "fast"],
	rapide: ["fast"],
	voile: [
		"motor",
		"sail",
		"fast"
	]
};
var PROFILE_KEYS = [
	"prudent",
	"confort",
	"rapide",
	"voile",
	"perso"
];
var ROUTAGE_DEFAULTS = {
	profile: "prudent",
	order: PRESETS.prudent,
	marginPct: 80,
	motorCapPct: 20,
	routesShown: 2,
	rapideMargin: 1,
	rapideMarginPct: 80,
	voileSlowCap: 1,
	voileSlowPct: 15,
	fuelTankL: PROPULSION_DEFAULTS.fuelTankL,
	fuelPct: PROPULSION_DEFAULTS.fuelPct,
	fuelLphPort: PROPULSION_DEFAULTS.fuelLphPort,
	fuelLphStbd: PROPULSION_DEFAULTS.fuelLphStbd,
	engineMode: PROPULSION_DEFAULTS.engineMode,
	fuelRpm: PROPULSION_DEFAULTS.fuelRpm,
	fuelReservePct: PROPULSION_DEFAULTS.fuelReservePct,
	orcaShow: 1,
	orcaAvoid: 0,
	orcaNm: 0,
	saharaShow: 1,
	saharaAvoid: 0,
	saharaNm: 50,
	...POLAR_UNCERT_DEFAULTS,
	...CREW_DEFAULTS
};
/** Les bornes (min, max) des valeurs numériques — les mêmes que l'app. */
var PREF_BOUNDS = {
	marginPct: [50, 100],
	motorCapPct: [0, 100],
	routesShown: [2, 5],
	rapideMargin: [0, 1],
	rapideMarginPct: [50, 100],
	voileSlowCap: [0, 1],
	voileSlowPct: [0, 100],
	fuelTankL: [20, 3e3],
	fuelPct: [0, 100],
	fuelLphPort: [.1, 20],
	fuelLphStbd: [.1, 20],
	engineMode: [0, 3],
	fuelRpm: [500, 4e3],
	fuelReservePct: [0, 60],
	orcaShow: [0, 1],
	orcaAvoid: [0, 1],
	orcaNm: [0, 60],
	saharaShow: [0, 1],
	saharaAvoid: [0, 1],
	saharaNm: [0, 200],
	...POLAR_UNCERT_BOUNDS,
	...CREW_BOUNDS
};
/**
* D22 bis — LE PROFIL « ✏️ PERSONNALISÉ » (Flavien, 27 oct.) : son ordre et ses
* valeurs à lui, ENREGISTRÉS à part (`routage_limits.custom`) — choisir Prudent
* puis revenir à Personnalisé le retrouve ; modifier un préréglage ne le change
* pas en silence (l'app propose « enregistrer comme Personnalisé »).
*/
var CUSTOM_KEYS = ["marginPct", "motorCapPct"];
function cleanCustom(c) {
	if (!c || typeof c !== "object") return null;
	const order = Array.isArray(c.order) ? [...new Set(c.order.filter((x) => PRIORITY_ITEMS.includes(x)))] : [];
	if (!order.length) return null;
	const out = { order };
	for (const k of CUSTOM_KEYS) if (c[k] != null && Number.isFinite(Number(c[k]))) out[k] = Math.min(PREF_BOUNDS[k][1], Math.max(PREF_BOUNDS[k][0], Number(c[k])));
	const w = cleanWeights(c.weights);
	if (w) out.weights = w;
	return out;
}
var num = (v, [lo, hi], d) => {
	if (v === null || v === void 0 || v === "") return d;
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
/**
* Les réglages d'un jeu de limites (défauts + Réglages + ce calcul), bornés ; l'inconnu est ignoré.
* RR-S (D35) : + `weights`, les poids du score sur 100 du profil EN VIGUEUR —
* ceux du préréglage, ou ceux du Personnalisé (`custom.weights`, sinon le
* préréglage qui ressemble à son ordre).
*/
function prefsOf(limits = {}) {
	const out = prefsOf0(limits);
	out.weights = weightsFor(out.profile, {
		customWeights: out.profile === "perso" ? out.custom?.weights : null,
		order: out.order
	});
	return out;
}
function prefsOf0(limits) {
	const L = limits && typeof limits === "object" ? limits : {};
	const out = {};
	for (const [k, b] of Object.entries(PREF_BOUNDS)) out[k] = num(typeof L[k] === "boolean" ? Number(L[k]) : L[k], b, ROUTAGE_DEFAULTS[k]);
	for (const k of [
		"engineMode",
		"routesShown",
		"rapideMargin",
		"voileSlowCap",
		"orcaShow",
		"orcaAvoid",
		"saharaShow",
		"saharaAvoid",
		"polarUncert",
		"crewN",
		"crewRested"
	]) out[k] = Math.round(out[k]);
	const order = Array.isArray(L.order) ? L.order.filter((x) => PRIORITY_ITEMS.includes(x)) : null;
	const profile = PROFILE_KEYS.includes(L.profile) ? L.profile : null;
	const custom = cleanCustom(L.custom);
	if (custom) out.custom = custom;
	if (profile === "perso" && custom) {
		out.order = custom.order;
		for (const k of CUSTOM_KEYS) if (custom[k] != null) out[k] = custom[k];
		out.profile = "perso";
		return out;
	}
	out.order = order && order.length ? [...new Set(order)] : profile && PRESETS[profile] ? PRESETS[profile] : ROUTAGE_DEFAULTS.order;
	out.profile = profile || (order ? presetOf(out.order) : ROUTAGE_DEFAULTS.profile);
	return out;
}
/** Le préréglage d'un ordre (ou « perso »). */
function presetOf(order) {
	for (const [k, v] of Object.entries(PRESETS)) if (v.length === order.length && v.every((x, i) => x === order[i])) return k;
	return "perso";
}
/** La marge sous les limites de B&C : 0,8 si `margin` est dans l'ordre (Prudent), sinon 1. */
var marginScale = (prefs) => prefs.order.includes("margin") ? Math.min(1, prefs.marginPct / 100) : 1;
/** ROUTE-015 — la marge de RAPIDE (les isochrones) : `rapideMarginPct` % si elle est en marche, sinon 1. */
var rapideScale = (prefs) => prefs.rapideMargin ? Math.min(1, prefs.rapideMarginPct / 100) : 1;
/** ROUTE-024 — l'écart permis de « Voile » à Rapide (%), ou null (arrêt). */
var voileSlowPctOf = (prefs) => prefs.voileSlowCap ? Math.max(0, Number(prefs.voileSlowPct) || 0) : null;
/** L'arrivée de jour est-elle une priorité ? */
var wantsDay = (prefs) => prefs.order.includes("day");
/** Les limites de B&C × s (vent, rafales, vagues) — l'angle de près et la côte ne changent pas. */
function scaleLimits(limits, s) {
	if (!(s < 1)) return limits;
	const r = (x) => Math.round(x * s * 10) / 10;
	return {
		...limits,
		maxTws: r(limits.maxTws),
		maxGust: r(limits.maxGust),
		maxWave: r(limits.maxWave)
	};
}
/**
* L'ordre pour l'optimiseur A* (graphRoute.parseOrder) : « limits:0.8,day,prudence,fast ».
* `comfort` devient `prudence` (confort + marges) quand la marge est demandée.
*/
function orderTokens(prefs) {
	const out = [];
	for (const it of prefs.order) if (it === "margin") {
		const s = marginScale(prefs);
		if (s < 1) out.push(`limits:${s}`);
	} else if (it === "day") out.push("day");
	else if (it === "comfort") out.push(prefs.order.includes("margin") ? "prudence" : "comfort");
	else if (it === "fast") out.push("fast");
	else if (it === "motor") {
		if (prefs.motorCapPct > 0 && prefs.motorCapPct < 100) out.push(`motor:${prefs.motorCapPct / 100}`);
	} else if (it === "sail") out.push("sail");
	if (!out.some((x) => !x.includes(":") && x !== "day")) out.push("fast");
	return out.join(",");
}
/**
* ROUTE-015 — les réglages + l'usage des moteurs MESURÉ au B&G (`engineUsage`,
* propulsion.mjs) : la consommation retenue est figée dans `fuelLphUsed`, et
* d'où elle vient dans `engine` (dit dans le résultat et les Réglages).
*/
function withEngineUsage(prefs, usage = null) {
	const e = fuelLphFor(prefs, usage);
	return {
		...prefs,
		fuelLphUsed: e.lph,
		engine: e
	};
}
/** La consommation retenue (L/h) : celle de withEngineUsage, sinon d'après le réglage (Auto sans mesures = un moteur). */
var fuelLphOf = (prefs) => Number.isFinite(prefs.fuelLphUsed) ? prefs.fuelLphUsed : fuelLphFor(prefs).lph;
/**
* LE BILAN DU GAZOLE d'une route (pur). motorH : heures de moteur ; motorKn :
* la vitesse au moteur (pour l'autonomie en milles). La réserve est une part
* de la CAPACITÉ (20 % de 550 L = 110 L).
* → { lph, aboardL, usedL, leftL, leftPct, reserveL, intoReserve, empty,
*     rangeH, rangeNm (au départ, réserve exclue), leftRangeH, leftRangeNm (à l'arrivée, réserve exclue) }
*/
function fuelPlan(motorH, prefs, motorKn = PROPULSION_DEFAULTS.motorKn) {
	const lph = fuelLphOf(prefs);
	const aboardL = prefs.fuelTankL * prefs.fuelPct / 100;
	const reserveL = prefs.fuelTankL * prefs.fuelReservePct / 100;
	const usedL = Math.max(0, Number(motorH) || 0) * lph;
	const leftL = aboardL - usedL;
	const usable = (l) => Math.max(0, l - reserveL);
	const r1 = (x) => Math.round(x * 10) / 10;
	return {
		lph,
		aboardL: r1(aboardL),
		usedL: r1(usedL),
		leftL: r1(leftL),
		leftPct: prefs.fuelTankL > 0 ? Math.round(leftL / prefs.fuelTankL * 100) : 0,
		reserveL: r1(reserveL),
		intoReserve: leftL < reserveL,
		empty: leftL < 0,
		rangeH: lph > 0 ? r1(usable(aboardL) / lph) : null,
		rangeNm: lph > 0 ? Math.round(usable(aboardL) / lph * motorKn) : null,
		leftRangeH: lph > 0 ? r1(usable(leftL) / lph) : null,
		leftRangeNm: lph > 0 ? Math.round(usable(leftL) / lph * motorKn) : null
	};
}
//#endregion
//#region scripts/routing/lib/hazards.mjs
var RAD$2 = Math.PI / 180;
var HAZARDS = [{
	id: "orca",
	kind: "orca",
	glyph: "🐋",
	ring: [
		[-5.2, 36.35],
		[-5.95, 36.75],
		[-6.4, 37.05],
		[-7.4, 37.45],
		[-8.2, 37.35],
		[-8.95, 37.25],
		[-9.35, 36.95],
		[-8.3, 36.45],
		[-7, 35.95],
		[-6.55, 35.2],
		[-6.05, 35.05],
		[-5.75, 35.55],
		[-5.55, 35.8],
		[-5.2, 35.75],
		[-5.2, 36.35]
	],
	seasonMonths: [
		4,
		5,
		6,
		7,
		8,
		9,
		10
	],
	source: "GTOA · MITECO · Instituto Hidrográfico (tracé à la main)"
}, {
	id: "sahara",
	kind: "offshore",
	glyph: "⚠",
	coast: [
		[-13.05, 27.67],
		[-13.4, 27.1],
		[-14, 26.55],
		[-14.5, 26.1],
		[-14.9, 25.3],
		[-15.45, 24.5],
		[-16, 23.65],
		[-16.35, 22.75],
		[-16.7, 22.3],
		[-17, 21.3],
		[-17.05, 20.77],
		[-16.55, 19.4],
		[-16.05, 18.1],
		[-16.05, 17],
		[-16.5, 16.05]
	],
	source: "trait de côte approximatif ; retours des propriétaires d'Outremer (B&C)"
}];
var signedArea = (ring) => {
	let s = 0;
	for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
	return s / 2;
};
/** Un anneau agrandi de `nm` milles (chaque sommet poussé vers l'extérieur, normales moyennées). */
function growRing(ring, nm) {
	if (!(nm > 0)) return ring;
	const open = ring.slice(0, -1);
	const n = open.length;
	const lat0 = open.reduce((s, p) => s + p[1], 0) / n;
	const k = Math.cos(lat0 * RAD$2);
	const ccw = signedArea(open.map(([x, y]) => [x * k, y]).concat([[open[0][0] * k, open[0][1]]])) > 0;
	const out = open.map((p, i) => {
		const a = open[(i - 1 + n) % n];
		const b = open[(i + 1) % n];
		const n1 = edgeNormal(a, p, k, ccw);
		const n2 = edgeNormal(p, b, k, ccw);
		let nx = n1[0] + n2[0];
		let ny = n1[1] + n2[1];
		const l = Math.hypot(nx, ny) || 1;
		nx /= l;
		ny /= l;
		const cos = Math.max(.35, nx * n1[0] + ny * n1[1]);
		const d = nm / 60 / cos;
		return [p[0] + nx * d / k, p[1] + ny * d];
	});
	return [...out, out[0]];
}
function edgeNormal(a, b, k, ccw) {
	const dx = (b[0] - a[0]) * k;
	const dy = b[1] - a[1];
	const l = Math.hypot(dx, dy) || 1;
	return ccw ? [dy / l, -dx / l] : [-dy / l, dx / l];
}
/** La bande de `nm` milles le long d'une côte (la mer à droite), refermée dans les terres. */
function coastBand(coast, nm) {
	const n = coast.length;
	const lat0 = coast.reduce((s, p) => s + p[1], 0) / n;
	const k = Math.cos(lat0 * RAD$2);
	const sea = coast.map((p, i) => {
		const a = coast[Math.max(0, i - 1)];
		const b = coast[Math.min(n - 1, i + 1)];
		const dx = (b[0] - a[0]) * k;
		const dy = b[1] - a[1];
		const l = Math.hypot(dx, dy) || 1;
		const rx = dy / l;
		const ry = -dx / l;
		return [p[0] + rx * nm / 60 / k, p[1] + ry * nm / 60];
	});
	const land = coast.map(([x, y]) => [x + .3, y]).reverse();
	return [
		...sea,
		...land,
		sea[0]
	];
}
/** Les zones des Réglages : [{ id, kind, glyph, show, avoid, nm, ring, source, seasonMonths? }]. */
function hazardZones(prefs) {
	const out = [];
	for (const h of HAZARDS) {
		const show = Boolean(prefs[`${h.id}Show`]);
		const avoid = Boolean(prefs[`${h.id}Avoid`]);
		const nm = Number(prefs[`${h.id}Nm`]) || 0;
		if (!show && !avoid) continue;
		const ring = h.coast ? coastBand(h.coast, Math.max(1, nm)) : growRing(h.ring, nm);
		out.push({
			id: h.id,
			kind: h.kind,
			glyph: h.glyph,
			show,
			avoid,
			nm,
			ring,
			source: h.source,
			seasonMonths: h.seasonMonths || null
		});
	}
	return out;
}
var xy = (p, k) => [p.lon * k * 60, p.lat * 60];
var orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
function ptSeg(px, py, x1, y1, x2, y2) {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const L = dx * dx + dy * dy;
	const t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
	const qx = x1 + t * dx;
	const qy = y1 + t * dy;
	return {
		d: Math.hypot(px - qx, py - qy),
		qx,
		qy
	};
}
function segsCross(a, b, c, d) {
	const d1 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
	const d2 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
	const d3 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
	const d4 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
	return (d1 <= 0 && d2 >= 0 || d1 >= 0 && d2 <= 0) && (d3 <= 0 && d4 >= 0 || d3 >= 0 && d4 <= 0);
}
/** Un point {lat, lon} : distance (milles) au bord d'un anneau, 0 dedans ; et le point du bord le plus proche. */
function pointToRing(p, ring) {
	const k = Math.cos(p.lat * RAD$2);
	const [px, py] = xy(p, k);
	let best = {
		d: Infinity,
		qx: 0,
		qy: 0
	};
	for (let i = 1; i < ring.length; i++) {
		const r = ptSeg(px, py, ring[i - 1][0] * k * 60, ring[i - 1][1] * 60, ring[i][0] * k * 60, ring[i][1] * 60);
		if (r.d < best.d) best = r;
	}
	const inside = inPolygon(p.lat, p.lon, ring);
	return {
		d: inside ? 0 : best.d,
		inside,
		q: {
			lon: best.qx / (k * 60),
			lat: best.qy / 60
		}
	};
}
/** Un segment a → b : distance (milles) à l'anneau, 0 s'il le touche ou y entre. */
function segmentToRing(a, b, ring) {
	if (inPolygon(a.lat, a.lon, ring) || inPolygon(b.lat, b.lon, ring)) return 0;
	const k = Math.cos((a.lat + b.lat) / 2 * RAD$2);
	const A = xy(a, k);
	const B = xy(b, k);
	let d = Infinity;
	for (let i = 1; i < ring.length; i++) {
		const C = [ring[i - 1][0] * k * 60, ring[i - 1][1] * 60];
		const D = [ring[i][0] * k * 60, ring[i][1] * 60];
		if (segsCross(A, B, C, D)) return 0;
		d = Math.min(d, ptSeg(A[0], A[1], C[0], C[1], D[0], D[1]).d, ptSeg(B[0], B[1], C[0], C[1], D[0], D[1]).d, ptSeg(C[0], C[1], A[0], A[1], B[0], B[1]).d, ptSeg(D[0], D[1], A[0], A[1], B[0], B[1]).d);
	}
	return d;
}
/**
* Les zones à éviter POUR CE CALCUL : celles qui sont cochées, sauf si elles
* contiennent (ou frôlent à moins de `freeNm`) un bout de la route — départ,
* porte, arrivée : on ne peut pas éviter l'endroit où l'on va. → { rings, lifted: [id] }
*/
function avoidRings(zones, stops, { freeNm = 1.5 } = {}) {
	const rings = [];
	const lifted = [];
	for (const z of zones) {
		if (!z.avoid) continue;
		if (stops.some((s) => pointToRing(s, z.ring).d < freeNm)) {
			lifted.push(z.id);
			continue;
		}
		rings.push(z.ring);
	}
	return {
		rings,
		lifted
	};
}
/**
* Les dangers LE LONG d'une route [{ t, lat, lon }] (pur) : pour chaque zone
* affichée ou évitée, à moins de `corridorNm` milles —
* { id, kind, glyph, inside, closestNm, atMs, side, enterMs, exitMs, insideH, inSeason, avoid, nm, source }.
* Chaque segment est échantillonné tous les ≈ 0,5 mille pour les heures ; la
* distance au plus près est celle du SEGMENT (exacte dans le plan local).
*/
function hazardsAlong(points, zones, { corridorNm = 30 } = {}) {
	const out = [];
	if (!Array.isArray(points) || points.length < 2) return out;
	for (const z of zones) {
		let best = {
			d: Infinity,
			t: null,
			side: null
		};
		let enter = null;
		let exit = null;
		let insideMs = 0;
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1];
			const b = points[i];
			const dSeg = segmentToRing(a, b, z.ring);
			if (dSeg > corridorNm && dSeg > best.d) continue;
			const n = Math.max(1, Math.min(200, Math.ceil(distNm(a, b) / .5)));
			for (let s = 0; s <= n; s++) {
				const f = s / n;
				const p = {
					lat: a.lat + (b.lat - a.lat) * f,
					lon: a.lon + (b.lon - a.lon) * f
				};
				const t = a.t + (b.t - a.t) * f;
				const r = pointToRing(p, z.ring);
				if (r.inside) {
					if (enter == null) enter = t;
					exit = t;
					if (s > 0) insideMs += (b.t - a.t) / n;
				}
				if (r.d < best.d || r.d === 0 && best.d === 0 && best.t == null) {
					const k = Math.cos(p.lat * RAD$2);
					const hx = (b.lon - a.lon) * k;
					const hy = b.lat - a.lat;
					const vx = (r.q.lon - p.lon) * k;
					const cr = hx * (r.q.lat - p.lat) - hy * vx;
					best = {
						d: r.d,
						t,
						side: r.inside ? null : cr > 0 ? "port" : "starboard"
					};
				}
			}
			if (dSeg === 0 && best.d > 0) best = {
				...best,
				d: 0
			};
		}
		if (!(best.d <= corridorNm)) continue;
		const seasonAt = enter ?? best.t;
		const inSeason = z.seasonMonths ? z.seasonMonths.includes(new Date(seasonAt).getUTCMonth() + 1) : null;
		out.push({
			id: z.id,
			kind: z.kind,
			glyph: z.glyph,
			inside: enter != null || best.d === 0,
			closestNm: Math.round(best.d * 10) / 10,
			atMs: best.t != null ? Math.round(best.t) : null,
			side: best.side,
			enterMs: enter != null ? Math.round(enter) : null,
			exitMs: exit != null ? Math.round(exit) : null,
			insideH: Math.round(insideMs / 36e5 * 10) / 10,
			inSeason,
			avoid: z.avoid,
			show: z.show,
			nm: z.nm,
			source: z.source
		});
	}
	return out.sort((x, y) => (x.enterMs ?? x.atMs ?? 0) - (y.enterMs ?? y.atMs ?? 0));
}
/** L'anneau d'une zone, arrondi pour l'écran (dessin seulement). */
var ringForMap = (ring) => ring.map(([lo, la]) => [Math.round(lo * 1e3) / 1e3, Math.round(la * 1e3) / 1e3]);
//#endregion
//#region scripts/routing/lib/graphRoute.mjs
var RAD$1 = Math.PI / 180;
var FEATURES = [
	"upwind",
	"beamSea",
	"bigSea",
	"gust",
	"night",
	"nightCoast",
	"motor",
	"nearLimit",
	"coast",
	"tss",
	"disagree",
	"wait",
	"fatigue",
	"rested"
];
var FI = Object.fromEntries(FEATURES.map((f, i) => [f, i]));
var NF = FEATURES.length;
var COMFORT = {
	upwind: .5,
	beamSea: .7,
	bigSea: .5,
	gust: 1,
	night: .15,
	nightCoast: .3,
	motor: .2,
	wait: .3,
	fatigue: 1,
	rested: 1
};
var MARGIN = {
	nearLimit: 1,
	coast: .5,
	tss: .5,
	wait: .3
};
/** Les critères sans seuil : leurs poids (en heures équivalentes par heure). */
var CRITERIA = {
	fast: {
		label: "Rapide",
		weights: {}
	},
	comfort: {
		label: "Confort",
		weights: COMFORT
	},
	margin: {
		label: "Marges",
		weights: MARGIN
	},
	prudence: {
		label: "Confort + marges",
		weights: {
			...COMFORT,
			...MARGIN
		}
	},
	sail: {
		label: "Voile",
		weights: { motor: 2 }
	},
	certainty: {
		label: "Certitude",
		weights: { disagree: .5 }
	}
};
/** Les critères à seuil (contraintes). */
var CONSTRAINTS = {
	limits: "Limites à x %",
	day: "Arrivée de jour",
	motor: "Moteur ≤ x %"
};
/** Les profils (D18) : un ordre de priorités, réglable. « Prudent » par défaut. */
var PROFILES = {
	rapide: {
		label: "Rapide",
		order: "fast"
	},
	confort: {
		label: "Confort",
		order: "comfort,fast"
	},
	prudent: {
		label: "Prudent",
		order: "limits:0.8,day,prudence,fast"
	},
	voile: {
		label: "Voile",
		order: "motor:0.2,sail,fast",
		policy: "choice"
	}
};
/** « limits:0.8,day,comfort,fast » → [{ c, value }]. */
function parseOrder(order) {
	return (Array.isArray(order) ? order : String(order).split(",")).map((it) => {
		if (typeof it === "object") return it;
		const [c, v] = it.trim().split(":");
		if (!CRITERIA[c] && !CONSTRAINTS[c]) throw new Error(`critère inconnu : ${c}`);
		return {
			c,
			value: v == null ? c === "day" ? true : null : Number(v)
		};
	});
}
var Heap = class {
	constructor() {
		this.a = [];
		this.max = 0;
	}
	get size() {
		return this.a.length;
	}
	push(x) {
		const a = this.a;
		a.push(x);
		let i = a.length - 1;
		while (i > 0) {
			const p = i - 1 >> 1;
			if (less(a[i], a[p])) {
				[a[i], a[p]] = [a[p], a[i]];
				i = p;
			} else break;
		}
		if (a.length > this.max) this.max = a.length;
	}
	pop() {
		const a = this.a;
		const top = a[0];
		const last = a.pop();
		if (a.length) {
			a[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let m = i;
				if (l < a.length && less(a[l], a[m])) m = l;
				if (r < a.length && less(a[r], a[m])) m = r;
				if (m === i) break;
				[a[i], a[m]] = [a[m], a[i]];
				i = m;
			}
		}
		return top;
	}
};
var less = (x, y) => x.f < y.f || x.f === y.f && x.seq < y.seq;
var STENCIL = (() => {
	const gcd = (a, b) => b ? gcd(b, a % b) : a;
	const out = [];
	for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) if ((di || dj) && gcd(Math.abs(di), Math.abs(dj)) === 1) out.push([di, dj]);
	return out;
})();
var ND = STENCIL.length;
/**
* Le réseau de la jambe a → b. `spacingNm` (défaut : longueur / 200, entre
* 0,5 et 3 milles), couloir ± max(15, 0,4 × longueur) milles, prolongé de
* max(5, 0,1 × longueur) aux deux bouts, coupé à `bbox` [O, S, E, N].
*/
function buildLattice(a, b, { spacingNm = null, widthNm = null, padNm = null, bbox = null, land, zones = null } = {}) {
	const len = distNm(a, b);
	const s = spacingNm ?? Math.min(3, Math.max(.5, len / 200));
	const W = widthNm ?? Math.max(15, .4 * len);
	const pad = padNm ?? Math.max(5, .1 * len);
	const k = Math.cos((a.lat + b.lat) / 2 * RAD$1);
	const bx = (b.lon - a.lon) * 60 * k;
	const by = (b.lat - a.lat) * 60;
	const L = Math.hypot(bx, by) || 1;
	const ux = bx / L;
	const uy = by / L;
	const vx = -uy;
	const vy = ux;
	const i0 = -Math.ceil(pad / s);
	const nI = Math.ceil((L + pad) / s) - i0 + 1;
	const jW = Math.ceil(W / s);
	const nJ = 2 * jW + 1;
	const n = nI * nJ;
	const lat = new Float64Array(n);
	const lon = new Float64Array(n);
	const ok = new Uint8Array(n);
	const inset = .02;
	for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) {
		const al = (i0 + i) * s;
		const cr = (j - jW) * s;
		const x = al * ux + cr * vx;
		const y = al * uy + cr * vy;
		const id = i * nJ + j;
		const la = a.lat + y / 60;
		const lo = a.lon + x / (60 * k);
		lat[id] = la;
		lon[id] = lo;
		if (bbox && (lo < bbox[0] + inset || lo > bbox[2] - inset || la < bbox[1] + inset || la > bbox[3] - inset)) continue;
		if (land.isLand(la, lo) || zones && zones.isLand(la, lo)) continue;
		ok[id] = 1;
	}
	return {
		a,
		b,
		s,
		nI,
		nJ,
		n,
		lat,
		lon,
		ok,
		len
	};
}
/** Les nœuds valides à moins de `R` milles d'un point (le rayon grandit s'il n'y en a pas). */
function nodesNear(lat_, p, R) {
	const { nI, nJ, lat, lon, ok } = lat_;
	for (let r = R; r <= R * 8; r *= 2) {
		const out = [];
		for (let id = 0; id < nI * nJ; id++) {
			if (!ok[id]) continue;
			if (Math.abs(lat[id] - p.lat) * 60 > r) continue;
			const d = distNm(p, {
				lat: lat[id],
				lon: lon[id]
			});
			if (d <= r && d > 1e-6) out.push({
				id,
				d
			});
		}
		if (out.length) return out.sort((x, y) => x.d - y.d || x.id - y.id);
	}
	return [];
}
/**
* Ce qui ne dépend que des cartes : les réseaux des jambes et leurs caches
* (arêtes vérifiées, voisinages). Réutilisable d'un profil à l'autre.
* stops : [départ, porte…, arrivée] ; charts = { land, coast, forbidden, forbiddenMask, coastIndex, bbox }.
*/
function prepareLegs(stops, { land, coast = null, forbidden = [], forbiddenMask = null, coastIndex = null, bbox = null, limits = {}, spacingNm = null, connectNm = null } = {}) {
	const L = {
		...DEFAULT_LIMITS,
		...limits
	};
	const tssNear = forbiddenMask ? dilateMask(forbiddenMask, 2) : null;
	const legs = [];
	for (let k = 0; k < stops.length - 1; k++) {
		const a = stops[k];
		const b = stops[k + 1];
		const coastFree = Boolean(a.strait && a.strait === b.strait);
		const lat_ = buildLattice(a, b, {
			spacingNm,
			bbox,
			land,
			zones: forbiddenMask
		});
		const R = connectNm ?? Math.max(1, 2.5 * lat_.s);
		const clear = makeClear({
			start: a,
			dest: b,
			L,
			land,
			coast,
			coastFree,
			forbidden,
			forbiddenMask,
			coastIndex,
			zoneStepNm: .05
		});
		const goalOf = new Map(nodesNear(lat_, b, R).map((x) => [x.id, x.d]));
		legs.push({
			k,
			a,
			b,
			coastFree,
			lattice: lat_,
			R,
			clear,
			startNbrs: nodesNear(lat_, a, R),
			goalOf,
			direct: distNm(a, b) <= R,
			edge: new Uint8Array(lat_.n * ND),
			elen: new Float32Array(lat_.n * ND),
			ehdg: new Float32Array(lat_.n * ND),
			node: new Uint8Array(lat_.n),
			h: new Float32Array(lat_.n).fill(-1),
			checks: 0
		});
	}
	const restNm = legs.map((_, k) => legs.slice(k + 1).reduce((s2, l) => s2 + l.lattice.len, 0));
	legs.forEach((l, k) => {
		l.restNm = restNm[k];
	});
	return {
		legs,
		coastIndex,
		tssNear,
		L
	};
}
var nightCache = /* @__PURE__ */ new Map();
/** La nuit à (lat, lon, t) — le soleil, au degré et à l'heure près (en cache). */
function isNight$1(lat, lon, t) {
	const key = `${Math.round(lat)}:${Math.round(lon)}:${Math.floor(t / 36e5)}`;
	let v = nightCache.get(key);
	if (v === void 0) {
		const tm = Math.floor(t / 36e5) * 36e5 + 18e5;
		const s = sunTimes(Math.round(lat), Math.round(lon), tm);
		v = s ? tm < s.rise || tm > s.set : false;
		if (nightCache.size > 2e5) nightCache.clear();
		nightCache.set(key, v);
	}
	return v;
}
/**
* L'OPTIMISEUR. opts = {
*   stops : [départ, porte…, arrivée] (ou start + dest), departMs,
*   polar, wind(lat, lon, ms) → { tws, twd, gust } | null, wave(lat, lon, ms) → m | null,
*   land, coast, forbidden, forbiddenMask, coastIndex, bbox, limits,
*   profile ('prudent'…) ou order ('limits:0.8,day,comfort,fast'), weights { critère: { feature: w } },
*   tolerance (0.05), policy ('crew' | 'choice'), spread(lat, lon, ms) → nds (option certitude),
*   maxHours (240), horizonMs, startWaitH (0), spacingNm, prepared (prepareLegs), maxLabels (3 000 000),
*   deadlineMs (heure limite absolue : au-delà, `reason: 'time'` — le service a un budget de temps),
*   slowCap ({ pct, refHours? } — ROUTE-024 : pas plus de pct % plus lente que la route la plus rapide ;
*            `refHours` = Rapide quand on la connaît, sinon la route A* au moteur libre)
* }
* → { ok, reason?, profile, order, arrivalMs, dayArrivalMs, waitH, hours, distanceNm, points, J, relaxed, sweep?, slowCap?, search }
*/
function optimise(opts) {
	const t0 = Date.now();
	const stops = opts.stops || [opts.start, opts.dest];
	const profKey = opts.profile || (opts.order ? null : "prudent");
	const prof = profKey ? PROFILES[profKey] : null;
	if (profKey && !prof) throw new Error(`profil inconnu : ${profKey}`);
	const order = parseOrder(opts.order || prof.order);
	const soft = order.filter((o) => CRITERIA[o.c]).map((o) => o.c);
	if (!soft.length) soft.push("fast");
	const cons = order.filter((o) => CONSTRAINTS[o.c]);
	const prepared = opts.prepared || prepareLegs(stops, opts);
	const motorCap = cons.find((o) => o.c === "motor")?.value ?? null;
	const policy = opts.policy || prof?.policy || (motorCap != null ? "choice" : "crew");
	const state = {
		limits: cons.find((o) => o.c === "limits")?.value ?? 1,
		day: cons.some((o) => o.c === "day" && o.value !== false)
	};
	const relaxed = [];
	const askedLimits = state.limits;
	const runAll = (lambda, onlyFirst = false) => {
		for (;;) {
			const r = lexi({
				...opts,
				stops,
				prepared,
				soft: onlyFirst ? soft.slice(0, 1) : soft,
				policy,
				lambda,
				limitsScale: state.limits,
				day: state.day
			});
			if (r.ok || r.short || r.reason === "search" || r.reason === "time") return r;
			let done = false;
			for (const o of cons.slice().reverse()) if (o.c === "limits" && state.limits < 1) {
				state.limits = Math.min(1, Math.round((state.limits + .1) * 100) / 100);
				done = true;
				break;
			}
			if (!done) return r;
		}
	};
	const slow = opts.slowCap && Number.isFinite(Number(opts.slowCap.pct)) ? {
		pct: Math.max(0, Number(opts.slowCap.pct)),
		refHours: Number.isFinite(Number(opts.slowCap.refHours)) && Number(opts.slowCap.refHours) > 0 ? Number(opts.slowCap.refHours) : null
	} : null;
	let slowInfo = null;
	const shareOf = (r) => r?.hours > 0 ? r.motorH / r.hours : 0;
	const fits = (r, limitH) => r?.ok && r.hours <= limitH + 1e-6;
	const dropMotorRelax = () => {
		for (let i = relaxed.length - 1; i >= 0; i--) if (relaxed[i].criterion === "motor") relaxed.splice(i, 1);
	};
	let res;
	let sweep = null;
	if (motorCap == null) {
		res = runAll(null);
		if (slow && res.ok && soft[0] === "sail") {
			let fast0 = null;
			let refH = slow.refHours;
			if (refH == null) {
				fast0 = runAll(0);
				refH = fast0.ok ? fast0.hours : null;
			}
			if (refH != null) {
				const limitH = refH * (1 + slow.pct / 100);
				slowInfo = {
					pct: slow.pct,
					refHours: round1(refH),
					limitH: round1(limitH),
					ref: slow.refHours != null ? "rapide" : "fastest"
				};
				if (!fits(res, limitH)) {
					const from = Math.round(shareOf(res) * 100) / 100;
					let got = null;
					let last = null;
					for (const lambda of [
						1,
						.5,
						.25,
						0
					]) {
						const r = lambda === 0 && fast0 ? fast0 : runAll(lambda);
						if (!r.ok) break;
						last = {
							r,
							lambda
						};
						if (fits(r, limitH)) {
							got = last;
							break;
						}
					}
					const pick = got || last;
					if (pick) {
						res = {
							...pick.r,
							lambda: pick.lambda
						};
						relaxed.push({
							criterion: "motor",
							why: "slow",
							asked: null,
							from,
							best: Math.round(shareOf(res) * 100) / 100,
							slowPct: slow.pct,
							...got ? {} : { reached: false }
						});
					}
				}
				slowInfo.hours = round1(res.hours);
				slowInfo.slowerPct = Math.round((res.hours / refH - 1) * 1e3) / 10;
			}
		}
	} else {
		sweep = [];
		const share = (r) => r.hours > 0 ? r.motorH / r.hours : 0;
		const tried = [];
		const tryL = (lambda) => {
			const r = runAll(lambda, true);
			sweep.push(r.ok ? {
				lambda: Math.round(lambda * 1e3) / 1e3,
				ok: true,
				hours: round1(r.hours),
				motorH: round1(r.motorH),
				share: Math.round(share(r) * 100) / 100
			} : {
				lambda,
				ok: false,
				reason: r.reason
			});
			if (r.ok) tried.push({
				lambda,
				r
			});
			return r;
		};
		let lo = null;
		let hi = null;
		let pick = null;
		let best = null;
		for (const lambda of [
			0,
			.5,
			1,
			2,
			4,
			8,
			16
		]) {
			const r = tryL(lambda);
			if (!r.ok) {
				if (r.short || r.reason === "search" || r.reason === "time") break;
				continue;
			}
			if (!best || share(r) < share(best.r)) best = {
				r,
				lambda
			};
			if (share(r) <= motorCap + 1e-9) {
				pick = {
					r,
					lambda
				};
				hi = lambda;
				break;
			}
			lo = lambda;
		}
		for (let k = 0; pick && lo != null && k < (opts.bisect ?? 3); k++) {
			const mid = lo === 0 ? hi / 2 : Math.sqrt(lo * hi);
			const r = tryL(mid);
			if (!r.ok) break;
			if (share(r) <= motorCap + 1e-9) {
				hi = mid;
				if (r.hours < pick.r.hours) pick = {
					r,
					lambda: mid
				};
			} else lo = mid;
		}
		if (pick) {
			const full = soft.length > 1 ? runAll(pick.lambda) : pick.r;
			res = full.ok && share(full) <= motorCap + 1e-9 ? full : pick.r;
			res = {
				...res,
				lambda: pick.lambda
			};
		} else if (best) {
			res = best.r;
			relaxed.push({
				criterion: "motor",
				asked: motorCap,
				best: Math.round(share(best.r) * 100) / 100
			});
		} else res = runAll(16);
		const fast0 = tried.find((x) => x.lambda === 0)?.r || null;
		const refH = slow ? slow.refHours ?? (fast0?.ok ? fast0.hours : null) : null;
		if (slow && res?.ok && refH != null) {
			const limitH = refH * (1 + slow.pct / 100);
			slowInfo = {
				pct: slow.pct,
				refHours: round1(refH),
				limitH: round1(limitH),
				ref: slow.refHours != null ? "rapide" : "fastest"
			};
			if (!fits(res, limitH)) {
				let ok = tried.filter((x) => fits(x.r, limitH)).sort((a, b) => b.lambda - a.lambda)[0] || null;
				let tooSlow = tried.filter((x) => !fits(x.r, limitH) && (!ok || x.lambda > ok.lambda)).sort((a, b) => a.lambda - b.lambda)[0] || null;
				for (let k = 0; ok && tooSlow && k < (opts.bisect ?? 3); k++) {
					const mid = ok.lambda === 0 ? tooSlow.lambda / 2 : Math.sqrt(ok.lambda * tooSlow.lambda);
					const r = tryL(mid);
					if (!r.ok) break;
					if (fits(r, limitH)) ok = {
						lambda: mid,
						r
					};
					else tooSlow = {
						lambda: mid,
						r
					};
				}
				dropMotorRelax();
				if (ok) {
					const full = soft.length > 1 ? runAll(ok.lambda) : ok.r;
					res = {
						...fits(full, limitH) ? full : ok.r,
						lambda: ok.lambda
					};
					relaxed.push({
						criterion: "motor",
						why: "slow",
						asked: motorCap,
						best: Math.round(share(res) * 100) / 100,
						slowPct: slow.pct
					});
				} else {
					const fastest = tried.slice().sort((a, b) => a.r.hours - b.r.hours)[0];
					if (fastest && fastest.r.hours < res.hours) res = {
						...fastest.r,
						lambda: fastest.lambda
					};
					relaxed.push({
						criterion: "motor",
						why: "slow",
						asked: motorCap,
						best: Math.round(share(res) * 100) / 100,
						slowPct: slow.pct,
						reached: false
					});
				}
			}
			slowInfo.hours = round1(res.hours);
			slowInfo.slowerPct = Math.round((res.hours / refH - 1) * 1e3) / 10;
		}
		sweep.sort((x, y) => x.lambda - y.lambda);
	}
	if (state.limits !== askedLimits) relaxed.unshift({
		criterion: "limits",
		asked: askedLimits,
		best: state.limits
	});
	const out = {
		...res,
		profile: profKey,
		order: order.map((o) => o.value == null || o.value === true ? o.c : `${o.c}:${o.value}`),
		policy,
		relaxed,
		sweep,
		...slowInfo ? { slowCap: slowInfo } : {}
	};
	out.search = {
		...res.search || {},
		ms: Date.now() - t0
	};
	return out;
}
var round1 = (x) => x == null ? null : Math.round(x * 10) / 10;
/** Les passes ε-lexicographiques sur la chaîne des jambes. */
function lexi(o) {
	const tol = o.tolerance ?? .05;
	const stars = [];
	let last = null;
	const passes = [];
	for (let k = 0; k < o.soft.length; k++) {
		const budgets = stars.map((v) => v * (1 + tol));
		const r = chainSearch({
			...o,
			crit: o.soft.slice(0, k + 1),
			obj: k,
			budgets
		});
		passes.push(r.search);
		if (!r.ok) {
			if (k === 0) return {
				...r,
				search: sumSearch(passes)
			};
			break;
		}
		stars.push(r.J[k]);
		last = r;
	}
	return {
		...last,
		search: sumSearch(passes),
		Jstar: stars
	};
}
var sumSearch = (ps) => ps.filter(Boolean).reduce((s, p) => {
	for (const [k, v] of Object.entries(p)) s[k] = k === "peakHeap" || k === "peakLabels" ? Math.max(s[k] || 0, v) : (s[k] || 0) + v;
	return s;
}, { passes: ps.length });
/** Une recherche complète (toutes les jambes) pour UNE passe. */
function chainSearch(o) {
	const { prepared, departMs, polar, wind, wave = null, crit, obj, budgets, lambda = null, limitsScale = 1, day = false, policy = "crew" } = o;
	const { legs, coastIndex, tssNear } = prepared;
	const L0 = {
		...DEFAULT_LIMITS,
		...o.limits || {}
	};
	const L = limitsScale === 1 ? L0 : {
		...L0,
		maxTws: L0.maxTws * limitsScale,
		maxGust: L0.maxGust * limitsScale,
		maxWave: L0.maxWave * limitsScale
	};
	const P = propulsionOf(L);
	const vmax = maxSpeedKn(P, polar);
	const nc = crit.length;
	const W = crit.map((c) => {
		const w = new Float64Array(NF);
		for (const [f, v] of Object.entries({
			...CRITERIA[c].weights,
			...o.weights?.[c] || {}
		})) w[FI[f]] = v;
		if (lambda != null) {
			if (c === "sail") w[FI.motor] = lambda;
			else if (c === crit[0] && !crit.includes("sail")) w[FI.motor] += lambda;
		}
		return w;
	});
	const used = new Uint8Array(NF);
	for (const w of W) for (let f = 0; f < NF; f++) if (w[f]) used[f] = 1;
	const needNight = used[FI.night] || used[FI.nightCoast];
	const needNode = used[FI.nightCoast] || used[FI.coast] || used[FI.tss];
	const maxEdgeH = o.maxEdgeH ?? 3;
	const maxH = o.maxHours ?? 240;
	const tMax = Math.min(departMs + maxH * 36e5, o.horizonMs ?? Infinity);
	const K = o.perNode ?? 12;
	const TAU = (o.tauH ?? 0) * 36e5;
	const PI_ = o.piH ?? 1e-6;
	const maxLabels = o.maxLabels ?? 3e6;
	const stats = {
		expanded: 0,
		labels: 0,
		edges: 0,
		pruned: 0,
		dominated: 0,
		peakHeap: 0,
		peakLabels: 0
	};
	let seq = 0;
	let beyond = false;
	const T = (t) => (t - departMs) / 36e5;
	const pen = (lab, i) => lab.J[i] - T(lab.t);
	const dominates = (x, y) => {
		if (x.t > y.t + TAU) return false;
		for (let i = 0; i < nc; i++) if (pen(x, i) > pen(y, i) + PI_) return false;
		return true;
	};
	const crew = P.crew || null;
	const fatW = crew ? W.map((w) => w[FI.fatigue]) : null;
	const restW = crew && crew.crewRested ? W.map((w) => w[FI.rested]) : null;
	const useFat = Boolean(fatW && fatW.some((x) => x > 0));
	const useRest = Boolean(restW && restW.some((x) => x > 0));
	let seeds = [{
		n: -1,
		lat: 0,
		lon: 0,
		t: departMs,
		J: new Array(nc).fill(0),
		par: null,
		mo: 0,
		waitH: 0,
		f: 0,
		seq: 0,
		dead: false,
		run: 0,
		hd: 0
	}];
	for (let h = 1; h <= (o.startWaitH ?? 0); h++) seeds.push({
		...seeds[0],
		t: departMs + h * 36e5,
		J: new Array(nc).fill(h),
		wait0: h
	});
	for (let li = 0; li < legs.length; li++) {
		const leg = legs[li];
		const final = li === legs.length - 1;
		const { lattice: G, clear } = leg;
		const fronts = /* @__PURE__ */ new Map();
		const heap = new Heap();
		const goals = [];
		let alive = 0;
		const hOf = (id) => {
			if (id === -2) return leg.restNm / vmax;
			if (id === -1) return (leg.lattice.len + leg.restNm) / vmax;
			let v = leg.h[id];
			if (v < 0) {
				v = distNm({
					lat: G.lat[id],
					lon: G.lon[id]
				}, leg.b) / vmax + leg.restNm / vmax;
				leg.h[id] = v;
			}
			return v;
		};
		const nodeFlags = (id) => {
			let v = leg.node[id];
			if (!v) {
				const p = {
					lat: G.lat[id],
					lon: G.lon[id]
				};
				v = 1;
				if (coastIndex) {
					if (coastIndex.near(p, p, 10)) v |= 2;
					if (v & 2 && coastIndex.near(p, p, 5)) v |= 4;
				}
				if (tssNear && tssNear.isLand(p.lat, p.lon)) v |= 8;
				leg.node[id] = v;
			}
			return v;
		};
		const push = (lab) => {
			const hq = hOf(lab.n);
			for (let i = 0; i < obj; i++) if (lab.J[i] + hq > budgets[i] + 1e-9) {
				stats.pruned++;
				return;
			}
			lab.f = lab.J[obj] + hq;
			lab.seq = seq++;
			if (lab.n === -2) {
				heap.push(lab);
				stats.labels++;
				return;
			}
			let fr = fronts.get(lab.n);
			if (!fr) {
				fr = [];
				fronts.set(lab.n, fr);
			}
			for (const s2 of fr) if (dominates(s2, lab)) {
				stats.dominated++;
				return;
			}
			for (let q = fr.length - 1; q >= 0; q--) if (dominates(lab, fr[q])) {
				fr[q].dead = true;
				fr.splice(q, 1);
				alive--;
			}
			fr.push(lab);
			alive++;
			if (fr.length > K) {
				let wi = 0;
				for (let q = 1; q < fr.length; q++) if (fr[q].f > fr[wi].f) wi = q;
				fr[wi].dead = true;
				const was = fr[wi];
				fr.splice(wi, 1);
				alive--;
				if (was === lab) return;
			}
			heap.push(lab);
			stats.labels++;
			if (alive > stats.peakLabels) stats.peakLabels = alive;
		};
		for (const s0 of seeds) push({
			n: -1,
			lat: leg.a.lat,
			lon: leg.a.lon,
			t: s0.t,
			J: s0.J.slice(),
			par: s0.par,
			mo: s0.mo,
			waitH: 0,
			f: 0,
			seq: 0,
			dead: false,
			run: s0.run || 0,
			hd: s0.hd || 0
		});
		const feat = new Float64Array(NF);
		let firstGoalF = null;
		while (heap.size) {
			const lab = heap.pop();
			if (lab.dead) continue;
			if (lab.n === -2) {
				if (final) {
					goals.push(lab);
					break;
				}
				if (firstGoalF == null) firstGoalF = lab.f;
				if (lab.f > firstGoalF + 6 || goals.length >= 8) break;
				if (!goals.some((g) => dominates(g, lab))) goals.push(lab);
				continue;
			}
			if (stats.labels > maxLabels) return {
				ok: false,
				reason: "search",
				search: stats
			};
			if (o.deadlineMs && (stats.expanded & 511) === 0 && Date.now() > o.deadlineMs) return {
				ok: false,
				reason: "time",
				search: stats
			};
			stats.expanded++;
			const p = lab;
			const t = lab.t;
			if (t >= tMax) {
				if (t >= (o.horizonMs ?? Infinity)) beyond = true;
				continue;
			}
			const w = wind(p.lat, p.lon, t);
			if (!w) {
				if (!(o.horizonMs && t <= o.horizonMs)) beyond = true;
				continue;
			}
			if (w.tws > L.maxTws || w.gust != null && w.gust > L.maxGust) continue;
			const hs0 = wave ? wave(p.lat, p.lon, t) : null;
			const minTwa = hs0 != null && hs0 >= L.seaWave ? L.minTwaInSea : L.minTwa;
			const night = needNight ? isNight$1(p.lat, p.lon, t) : false;
			const nf = needNode && lab.n >= 0 ? nodeFlags(lab.n) : 0;
			const gustHi = w.gust != null && w.gust > .8 * L0.maxGust;
			const nearLim = w.tws > .8 * L0.maxTws || gustHi || hs0 != null && hs0 > .8 * L0.maxWave;
			const disagree = used[FI.disagree] && o.spread ? (o.spread(p.lat, p.lon, t) ?? 0) >= 5 : false;
			const targets = [];
			if (lab.n === -1) {
				for (const nb of leg.startNbrs) targets.push({
					id: nb.id,
					d: nb.d,
					hdg: null
				});
				if (leg.direct) targets.push({
					id: -2,
					d: distNm(p, leg.b),
					hdg: null
				});
			} else {
				const i = Math.floor(lab.n / G.nJ);
				const j = lab.n - i * G.nJ;
				for (let dI = 0; dI < ND; dI++) {
					const i2 = i + STENCIL[dI][0];
					const j2 = j + STENCIL[dI][1];
					if (i2 < 0 || j2 < 0 || i2 >= G.nI || j2 >= G.nJ) continue;
					const id2 = i2 * G.nJ + j2;
					if (!G.ok[id2]) continue;
					const e = lab.n * ND + dI;
					let st = leg.edge[e];
					if (!st) {
						const q = {
							lat: G.lat[id2],
							lon: G.lon[id2]
						};
						st = clear(p, q) ? 1 : 2;
						leg.checks++;
						leg.edge[e] = st;
						leg.elen[e] = distNm(p, q);
						leg.ehdg[e] = bearing(p, q);
					}
					if (st === 1) targets.push({
						id: id2,
						d: leg.elen[e],
						hdg: leg.ehdg[e]
					});
				}
				const gd = leg.goalOf.get(lab.n);
				if (gd != null) targets.push({
					id: -2,
					d: gd,
					hdg: null
				});
			}
			for (const tg of targets) {
				const q = tg.id === -2 ? leg.b : {
					lat: G.lat[tg.id],
					lon: G.lon[tg.id]
				};
				if (tg.hdg == null) {
					if (!clear(p, q)) continue;
					tg.hdg = bearing(p, q);
				}
				const twa = twaAbs(tg.hdg, w.twd);
				const opts2 = propulsionOptions(P, polar, {
					tws: w.tws,
					twa,
					hs: hs0,
					minTwa,
					elapsedH: T(t)
				}, policy);
				for (const go of opts2) {
					stats.edges++;
					const dtH = tg.d / go.speed;
					if (dtH > maxEdgeH) continue;
					const t2 = t + dtH * 36e5;
					if (t2 > tMax) continue;
					if (wave) {
						const hs2 = wave(q.lat, q.lon, t2);
						if (hs2 != null && hs2 > L.maxWave) continue;
					}
					feat.fill(0);
					if (twa < 70 && w.tws >= 8) feat[FI.upwind] = 1;
					if (hs0 != null && hs0 >= 1.5 && twa >= 60 && twa <= 120) feat[FI.beamSea] = 1;
					if (hs0 != null && hs0 > 2) feat[FI.bigSea] = 1;
					if (gustHi) feat[FI.gust] = 1;
					if (night) {
						feat[FI.night] = 1;
						if (nf & 2) feat[FI.nightCoast] = 1;
					}
					if (go.mode === "moteur") feat[FI.motor] = 1;
					if (nearLim) feat[FI.nearLimit] = 1;
					if (nf & 4) feat[FI.coast] = 1;
					if (nf & 8) feat[FI.tss] = 1;
					if (disagree) feat[FI.disagree] = 1;
					const J2 = new Array(nc);
					for (let c = 0; c < nc; c++) {
						let r = 1;
						const wc = W[c];
						for (let f = 0; f < NF; f++) if (feat[f]) r += wc[f];
						J2[c] = lab.J[c] + dtH * r;
					}
					const hard = w.tws > 20 || go.mode !== "moteur" && twa < 70 && w.tws >= 8 ? 1 : 0;
					const run2 = hard ? (lab.run || 0) + dtH : 0;
					if (useFat && hard) {
						const over = Math.max(0, run2 - Math.max(crew.runCapH, lab.run || 0));
						if (over > 0) for (let c = 0; c < nc; c++) J2[c] += fatW[c] * over;
					}
					let waitH = 0;
					if (tg.id === -2 && final && day) {
						const lt = arrivalLight(leg.b.lat, leg.b.lon, t2);
						if (!lt.day) {
							waitH = lt.waitH;
							for (let c = 0; c < nc; c++) J2[c] += waitH * (1 + W[c][FI.wait]);
						}
					}
					if (useRest && tg.id === -2 && final) {
						const night2 = waitH > 0 ? false : !arrivalLight(leg.b.lat, leg.b.lon, t2).day;
						const lim = t2 - 12 * 36e5;
						let hardH = hard ? Math.min(dtH, (t2 - Math.max(lim, t)) / 36e5) : 0;
						for (let x = lab; x && x.par && x.t > lim; x = x.par) if (x.hd) hardH += (x.t - Math.max(lim, x.par.t)) / 36e5;
						const pen = (night2 ? 3 : 0) + RESTED_HARD_W * hardH;
						if (pen > 0) for (let c = 0; c < nc; c++) J2[c] += restW[c] * pen;
					}
					push({
						n: tg.id,
						lat: q.lat,
						lon: q.lon,
						t: t2,
						J: J2,
						par: lab,
						mo: go.mode === "moteur" ? 1 : 0,
						waitH,
						f: 0,
						seq: 0,
						dead: false,
						run: run2,
						hd: hard
					});
				}
			}
			if (heap.max > stats.peakHeap) stats.peakHeap = heap.max;
		}
		stats.edgeChecks = (stats.edgeChecks || 0) + leg.checks;
		leg.checks = 0;
		if (!goals.length) return beyond ? {
			ok: false,
			short: true,
			reason: `prévision trop courte pour ${legs.length > 1 ? `la jambe ${li + 1}` : "atteindre l'arrivée"}`,
			search: stats
		} : {
			ok: false,
			reason: `aucune route dans les limites${legs.length > 1 ? ` (jambe ${li + 1})` : ""}`,
			search: stats
		};
		seeds = goals;
	}
	return finish(seeds[0], {
		departMs,
		stats,
		wave,
		wind
	});
}
/**
* Remonter la route et la décrire comme route() : un point porte l'arête qui
* en part (cap, vitesse, mode, vent au départ de l'arête — recalculés).
*/
function finish(best, { departMs, stats, wave, wind }) {
	const chain = [];
	for (let n = best; n; n = n.par) chain.push(n);
	chain.reverse();
	let distanceNm = 0;
	let motorH = 0;
	const points = chain.map((a, i) => {
		const b = chain[i + 1];
		const pt = {
			t: a.t,
			lat: a.lat,
			lon: a.lon,
			heading: null,
			speed: null,
			mode: null,
			tws: null,
			twd: null,
			twa: null,
			gust: null,
			wave: wave ? wave(a.lat, a.lon, a.t) : null
		};
		if (b) {
			const d = distNm(a, b);
			const h = (b.t - a.t) / 36e5;
			const w = wind(a.lat, a.lon, a.t);
			distanceNm += d;
			if (b.mo) motorH += h;
			pt.heading = bearing(a, b);
			pt.speed = h > 0 ? d / h : 0;
			pt.mode = b.mo ? "moteur" : "voile";
			if (w) {
				pt.tws = w.tws;
				pt.twd = w.twd;
				pt.twa = twaAbs(pt.heading, w.twd);
				pt.gust = w.gust ?? null;
			}
		}
		return pt;
	});
	return {
		ok: true,
		arrivalMs: best.t,
		waitH: best.waitH || 0,
		dayArrivalMs: best.t + (best.waitH || 0) * 36e5,
		hours: (best.t - departMs) / 36e5,
		distanceNm,
		points,
		motorH,
		J: best.J.slice(),
		search: stats
	};
}
/** La distance à la côte exacte d'un segment (milles, ≤ `cap`), par dichotomie sur near(). */
function clearanceNm(coastIndex, a, b, cap = 20) {
	if (!coastIndex.near(a, b, cap)) return cap;
	if (coastIndex.crosses(a, b)) return 0;
	let lo = 0;
	let hi = cap;
	for (let k = 0; k < 12; k++) {
		const m = (lo + hi) / 2;
		if (coastIndex.near(a, b, m)) hi = m;
		else lo = m;
	}
	return lo;
}
/**
* LE BILAN D'UNE ROUTE, le même pour les deux moteurs (pur) : ce que l'écran
* compare d'un profil à l'autre. `stops` : les bouts et les portes (le
* dégagement n'y est pas compté : un port est près de la côte).
*/
function routeStats(points, { coastIndex = null, stops = [], waitH = 0, freeNm = 1.5 } = {}) {
	let distanceNm = 0;
	let motorH = 0;
	let sailH = 0;
	let upwindH = 0;
	let beamSeaH = 0;
	let nightH = 0;
	let maxTws = 0;
	let maxGust = null;
	let maxWave = 0;
	let minCoastNm = null;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		const h = (b.t - a.t) / 36e5;
		distanceNm += distNm(a, b);
		if (a.mode === "moteur") motorH += h;
		else sailH += h;
		if (a.twa != null && a.twa < 70 && (a.tws ?? 0) >= 8) upwindH += h;
		if (a.wave != null && a.wave >= 1.5 && a.twa >= 60 && a.twa <= 120) beamSeaH += h;
		if (isNight$1(a.lat, a.lon, a.t + (b.t - a.t) / 2)) nightH += h;
		maxTws = Math.max(maxTws, a.tws || 0);
		if (a.gust != null) maxGust = Math.max(maxGust ?? 0, a.gust);
		maxWave = Math.max(maxWave, a.wave || 0);
		if (coastIndex && !stops.some((s) => distNm(a, s) < freeNm || distNm(b, s) < freeNm)) {
			const c = clearanceNm(coastIndex, a, b);
			minCoastNm = minCoastNm == null ? c : Math.min(minCoastNm, c);
		}
	}
	const hours = points.length ? (points.at(-1).t - points[0].t) / 36e5 : 0;
	return {
		hours,
		distanceNm,
		motorH,
		sailH,
		motorShare: hours ? motorH / hours : 0,
		upwindH,
		beamSeaH,
		nightH,
		maxTws,
		maxGust,
		maxWave,
		minCoastNm,
		waitH
	};
}
//#endregion
//#region scripts/routing/lib/optimiser.mjs
/** Les profils de l'optimiseur (Rapide = les isochrones). */
var ASTAR_PROFILES = [
	"prudent",
	"confort",
	"voile"
];
var r1$1 = (x) => x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;
/**
* Les profils à calculer par l'A* (pur) : le profil choisi (sauf Rapide), puis
* les autres jusqu'à `routesShown − 1` (Rapide compte pour une route).
*/
function profilesToRun(prefs) {
	const want = Math.max(1, Math.min(4, (prefs.routesShown || 2) - 1));
	const list = [];
	if (prefs.profile !== "rapide") list.push(prefs.profile);
	for (const k of ASTAR_PROFILES) if (list.length < want && !list.includes(k)) list.push(k);
	return list.slice(0, want);
}
/** L'ordre A* d'un profil : celui des Réglages pour le profil choisi (ses valeurs), le préréglage sinon. */
function orderFor(key, prefs) {
	if (key === prefs.profile) return orderTokens(prefs);
	if (key === "perso") return prefs.custom ? orderTokens({
		...prefs,
		...prefs.custom
	}) : orderTokens(prefs);
	return orderTokens({
		...prefs,
		order: PRESETS[key] || PRESETS.prudent
	});
}
var at$1 = (pts, t) => {
	if (t <= pts[0].t) return pts[0];
	for (let i = 0; i < pts.length - 1; i++) if (t <= pts[i + 1].t) {
		const f = (t - pts[i].t) / (pts[i + 1].t - pts[i].t || 1);
		return {
			lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * f,
			lon: pts[i].lon + (pts[i + 1].lon - pts[i].lon) * f
		};
	}
	return pts.at(-1);
};
/** L'écart latéral maximal entre deux routes (toutes les heures), en milles. */
function lateralNm(a, b) {
	if (!a?.length || !b?.length) return null;
	let m = 0;
	const t1 = Math.min(a.at(-1).t, b.at(-1).t);
	for (let t = a[0].t; t <= t1; t += 36e5) m = Math.max(m, distNm(at$1(a, t), at$1(b, t)));
	return m;
}
/** Le point de vent le plus fort d'une route (heure, force). */
function windPeak(points) {
	let best = null;
	for (const p of points) if (p.tws != null && (!best || p.tws > best.tws)) best = {
		t: p.t,
		tws: p.tws
	};
	return best;
}
/**
* Le bilan d'une route pour la comparaison (pur) — le MÊME pour les isochrones
* et l'A* : arrivée (et à quai de jour), vent / rafales / vagues max, heures
* de moteur → litres et reste, près, nuit, côte au plus près, dangers.
*/
function summarizeRoute(points, { key, source, model, to, stops, coastIndex, zones, prefs, motorKn, waitH = 0, extra = {} }) {
	const s = routeStats(points, {
		coastIndex,
		stops,
		waitH
	});
	const arrivalMs = points.at(-1).t;
	const dayArrivalMs = arrivalMs + waitH * 36e5;
	const light = arrivalLight(to.lat, to.lon, dayArrivalMs);
	const fuel = fuelPlan(s.motorH, prefs, motorKn);
	const peak = windPeak(points);
	return {
		ok: true,
		key,
		source,
		model,
		arrivalMs,
		dayArrivalMs,
		waitH: r1$1(waitH),
		hours: r1$1(s.hours + waitH),
		distanceNm: Math.round(s.distanceNm),
		motorH: r1$1(s.motorH),
		motorShare: Math.round(s.motorShare * 100) / 100,
		upwindH: r1$1(s.upwindH),
		beamSeaH: r1$1(s.beamSeaH),
		nightH: r1$1(s.nightH),
		maxTws: r1$1(s.maxTws),
		maxGust: r1$1(s.maxGust),
		maxWave: r1$1(s.maxWave),
		minCoastNm: r1$1(s.minCoastNm),
		windPeak: peak ? {
			t: peak.t,
			tws: r1$1(peak.tws)
		} : null,
		day: Boolean(light.day),
		fuel: {
			usedL: fuel.usedL,
			leftL: fuel.leftL,
			leftPct: fuel.leftPct,
			intoReserve: fuel.intoReserve,
			empty: fuel.empty
		},
		hazards: hazardsAlong(points, zones).map((h) => ({
			id: h.id,
			inside: h.inside,
			closestNm: h.closestNm,
			insideH: h.insideH
		})),
		...extra
	};
}
/**
* POURQUOI ce profil plutôt que Rapide, en codes (pur), les plus parlants
* d'abord, 4 au plus : « plus lent de 5 h pour éviter 22 nds jeu. 14:00 ».
*/
function profileWhy(p, rapide) {
	if (!p?.ok) return [{ code: p?.reason === "time" ? "tooLong" : p?.short ? "short" : "noRoute" }];
	const out = [];
	for (const r of p.relaxed || []) {
		if (r.criterion === "motor" && r.why === "slow") {
			out.push({
				code: "relaxedMotorSlow",
				asked: r.asked == null ? null : Math.round(r.asked * 100),
				best: Math.round(r.best * 100),
				pct: r.slowPct,
				reached: r.reached !== false
			});
			continue;
		}
		out.push({
			code: r.criterion === "motor" ? "relaxedMotor" : "relaxedLimits",
			asked: Math.round(r.asked * 100),
			best: Math.round(r.best * 100)
		});
	}
	if (!rapide?.ok) return out;
	const dh = p.hours - rapide.hours;
	if (rapide.maxTws - p.maxTws >= 2) out.push({
		code: "lessWind",
		a: rapide.maxTws,
		b: p.maxTws,
		atMs: rapide.windPeak?.t ?? null,
		dh: r1$1(dh)
	});
	if (rapide.maxWave - p.maxWave >= .3) out.push({
		code: "lessWave",
		a: rapide.maxWave,
		b: p.maxWave
	});
	if (!rapide.day && p.day) out.push({
		code: "dayArrival",
		waitH: p.waitH || 0
	});
	else if (p.waitH > 0) out.push({
		code: "waits",
		h: p.waitH
	});
	if (rapide.upwindH - p.upwindH >= 2) out.push({
		code: "lessUpwind",
		a: rapide.upwindH,
		b: p.upwindH
	});
	if (rapide.motorH - p.motorH >= 3) out.push({
		code: "lessMotor",
		h: r1$1(rapide.motorH - p.motorH),
		l: Math.round(rapide.fuel.usedL - p.fuel.usedL)
	});
	else if (p.motorH - rapide.motorH >= 3) out.push({
		code: "moreMotor",
		h: r1$1(p.motorH - rapide.motorH),
		l: Math.round(p.fuel.usedL - rapide.fuel.usedL)
	});
	for (const h of rapide.hazards || []) if (h.inside && !(p.hazards || []).some((x) => x.id === h.id && x.inside)) out.push({
		code: "avoidsHazard",
		id: h.id
	});
	if (!out.some((x) => x.code === "lessWind") && Math.abs(dh) >= .5) out.push({
		code: dh > 0 ? "slower" : "faster",
		h: r1$1(Math.abs(dh))
	});
	if (!out.length) out.push({ code: "same" });
	return out.slice(0, 4);
}
/**
* Lance l'A* pour `keys` sur un groupe de fils (graphWorker.mjs). Rend tout de
* suite { done: Promise<{ [key]: résultat brut }>, close() } : le conseil le
* lance PENDANT les isochrones et l'attend après.
* ctx = { polar, grid, model, waves, land, coast, forbidden, forbiddenMask, coastIndex, bbox, limits, stops, departMs, prefs, threads, deadlineMs, onDone,
*         slowCap? ({ pct, refHours } — ROUTE-024 : pour « Voile » seulement), createPool? (ROUTE-028 : les Web Workers du navigateur) }
*/
function runOptimiser(ctx, keys) {
	if (!keys.length) return {
		done: Promise.resolve({}),
		close: async () => {}
	};
	const pool = (ctx.createPool || createPool)(new URL("./graphWorker.mjs", import.meta.url), {
		polar: ctx.polar,
		grids: { [ctx.model]: ctx.grid },
		waves: ctx.waves,
		land: ctx.land.data,
		coast: ctx.coast?.data || null,
		forbidden: ctx.forbidden,
		forbiddenMask: ctx.forbiddenMask?.data || null,
		coastIndex: ctx.coastIndex?.data || null,
		bbox: ctx.bbox,
		limits: ctx.limits
	}, Math.max(1, Math.min(keys.length, ctx.threads || 1)));
	let n = 0;
	return {
		done: Promise.all(keys.map((k) => pool.run({
			model: ctx.model,
			stops: ctx.stops,
			departMs: ctx.departMs,
			profile: null,
			order: orderFor(k, ctx.prefs),
			options: {
				policy: k === "voile" || /motor:/.test(orderFor(k, ctx.prefs)) ? "choice" : "crew",
				deadlineMs: ctx.deadlineMs,
				maxHours: 400,
				...k === "voile" && ctx.slowCap ? { slowCap: ctx.slowCap } : {}
			}
		}).then((r) => {
			ctx.onDone?.(++n, keys.length);
			return [k, r];
		}, (e) => {
			ctx.onDone?.(++n, keys.length);
			return [k, {
				ok: false,
				reason: "error",
				error: String(e.message || e)
			}];
		}))).then((pairs) => Object.fromEntries(pairs)).finally(() => pool.close()),
		close: () => pool.close()
	};
}
//#endregion
//#region scripts/routing/lib/departures.mjs
var DEP_ROWS = [
	"confort",
	"voile",
	"rapide",
	"prudent"
];
var r1 = (x) => x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;
var LEVELS$1 = [
	"élevée",
	"moyenne",
	"faible"
];
/**
* L'ordre d'une case : les contraintes (limites, jour, moteur) et le PREMIER
* critère seulement (pur). Une passe A* au lieu de deux — le second critère
* (« rapide ») ne fait que départager des routes presque égales ; mesuré : le
* temps de la grille divisé par ≈ 2. « sail,fast » → « sail ».
*/
function firstPassOrder(order) {
	const toks = String(order || "").split(",").map((x) => x.trim()).filter(Boolean);
	const out = [];
	let soft = false;
	for (const t of toks) if (t.includes(":") || t === "day") out.push(t);
	else if (!soft) {
		out.push(t);
		soft = true;
	}
	if (!soft) out.push("fast");
	return out.join(",");
}
var worst$1 = (...ls) => LEVELS$1[Math.max(...ls.map((l) => Math.max(0, LEVELS$1.indexOf(l))))];
/** L'ordre « du gros au fin » des colonnes : 0, n−1, le milieu, puis les quarts… (pur). */
function coarseToFine(n) {
	if (n <= 0) return [];
	const out = [0];
	const seen = new Set([0]);
	if (n > 1) {
		out.push(n - 1);
		seen.add(n - 1);
	}
	let segs = [[0, n - 1]];
	while (segs.length) {
		const next = [];
		for (const [a, b] of segs) {
			if (b - a < 2) continue;
			const m = Math.floor((a + b) / 2);
			if (!seen.has(m)) {
				seen.add(m);
				out.push(m);
			}
			next.push([a, m], [m, b]);
		}
		segs = next;
	}
	for (let i = 0; i < n; i++) if (!seen.has(i)) out.push(i);
	return out;
}
/**
* La fenêtre réelle (pur) : demandée, bornée par la prévision moins le passage
* (+ 15 % et 6 h de marge : une route plus lente que Rapide doit encore tenir).
* → { windowH, askedH, maxH, clamped, deps: [ms] }
*/
function departureWindow({ departMs, horizonMs, passageH, askedH = 48, stepH = 3 }) {
	const asked = Math.max(0, Math.min(216, Number(askedH) || 48));
	const room = Number.isFinite(horizonMs) && Number.isFinite(passageH) ? (horizonMs - departMs) / 36e5 - passageH * 1.15 - 6 : asked;
	const maxH = Math.max(0, Math.floor(room / stepH) * stepH);
	const windowH = Math.min(asked, maxH);
	const deps = [];
	for (let h = 0; h <= windowH + 1e-9; h += stepH) deps.push(departMs + h * 36e5);
	return {
		windowH,
		askedH: asked,
		maxH,
		clamped: windowH < asked,
		deps
	};
}
/**
* Le bilan d'une case (pur) : ce que la grille, la comparaison et les scores
* lisent. `points` : la route ([{ t, lat, lon, mode, tws, twa, gust, wave }] —
* le point porte l'arête qui en part). `L` = les limites de B&C (D5) + les
* réglages (gazole, équipage) ; `isNight(lat, lon, t)`.
*/
function cellStats(points, { L, to, isNight, arrivalLight, waitH = 0, fuelLph = 2.63, fuelAboardL = 550, fuelReserveL = 110 }) {
	let distanceNm = 0;
	let motorH = 0;
	let sailH = 0;
	let upwindH = 0;
	let h20 = 0;
	let hWave2 = 0;
	let nightH = 0;
	let maxTws = 0;
	let maxGust = null;
	let maxWave = 0;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		const h = (b.t - a.t) / 36e5;
		if (!(h > 0)) continue;
		distanceNm += distNm(a, b);
		if (a.mode === "moteur") motorH += h;
		else sailH += h;
		if (a.mode !== "moteur" && a.twa != null && a.twa < 70 && (a.tws ?? 0) >= 8) upwindH += h;
		if ((a.tws ?? 0) > 20) h20 += h;
		if ((a.wave ?? 0) > 2) hWave2 += h;
		if (isNight && isNight(a.lat, a.lon, a.t + (b.t - a.t) / 2)) nightH += h;
		maxTws = Math.max(maxTws, a.tws || 0);
		if (a.gust != null) maxGust = Math.max(maxGust ?? 0, a.gust);
		maxWave = Math.max(maxWave, a.wave || 0);
	}
	const dep = points[0].t;
	const arr = points.at(-1).t;
	const dayArr = arr + waitH * 36e5;
	const hours = (arr - dep) / 36e5 + waitH;
	const ratio = Math.max(maxTws / L.maxTws, maxGust != null ? maxGust / L.maxGust : 0, maxWave / L.maxWave);
	const litres = motorH * fuelLph;
	const light = arrivalLight ? arrivalLight(to.lat, to.lon, dayArr) : { day: true };
	const fat = fatigueAlong(points, L, {
		isNight,
		arrivalDay: Boolean(light.day),
		waitH
	});
	const run = sailH + motorH;
	return {
		arrivalMs: arr,
		dayArrivalMs: dayArr,
		waitH: r1(waitH),
		hours: r1(hours),
		day: Boolean(light.day),
		distanceNm: Math.round(distanceNm),
		maxTws: r1(maxTws),
		maxGust: r1(maxGust),
		maxWave: r1(maxWave),
		limitRatio: Math.round(ratio * 100) / 100,
		marginPct: Math.round((1 - ratio) * 100),
		sailPct: run > 0 ? Math.round(sailH / run * 100) : 100,
		motorH: r1(motorH),
		litres: Math.round(litres),
		fuelLeftL: Math.round(fuelAboardL - litres),
		intoReserve: fuelAboardL - litres < fuelReserveL,
		upwindH: r1(upwindH),
		h20: r1(h20),
		hWave2: r1(hWave2),
		nightH: r1(nightH),
		nights: fat.nights,
		fatigue: {
			overH: fat.overH,
			maxRunH: fat.maxRunH,
			lastHardH: fat.lastHardH,
			restedH: fat.restedH,
			decayPct: fat.decayPct,
			score: fat.score,
			top: fat.runs[0] || null
		}
	};
}
/**
* D35 — les heures dans chaque zone de danger le long d'une route (pur) : la
* géométrie de « À surveiller » (hazardsAlong, les zones des Réglages — affichées
* ou évitées). → { [id]: heures } (seulement les zones où l'on entre ; {} : aucune).
*/
function hazardHours(points, zones) {
	const out = {};
	if (!Array.isArray(zones) || !zones.length) return out;
	for (const h of hazardsAlong(points, zones)) if (h.insideH > 0) out[h.id] = h.insideH;
	return out;
}
/**
* D35 — LE BILAN d'une route qui n'est pas une case (la route d'un modèle, une
* sensibilité) : ce que « Ce qui changerait la réponse » mesure sur cinq mesures
* (limites, confort, sécurité, score) — les champs de cellStats qui comptent,
* plus `hazardH`. `opts` = ceux de cellStats + `zones`.
*/
function bilanOf(points, { zones = null, ...opts }) {
	if (!Array.isArray(points) || points.length < 2) return null;
	const s = cellStats(points, opts);
	return {
		hours: s.hours,
		waitH: s.waitH,
		day: s.day,
		dayArrivalMs: s.dayArrivalMs,
		distanceNm: s.distanceNm,
		maxTws: s.maxTws,
		maxGust: s.maxGust,
		maxWave: s.maxWave,
		limitRatio: s.limitRatio,
		marginPct: s.marginPct,
		sailPct: s.sailPct,
		motorH: s.motorH,
		intoReserve: s.intoReserve,
		upwindH: s.upwindH,
		h20: s.h20,
		hWave2: s.hWave2,
		nightH: s.nightH,
		nights: s.nights,
		fatigue: {
			overH: s.fatigue.overH,
			restedH: s.fatigue.restedH,
			maxRunH: s.fatigue.maxRunH,
			score: s.fatigue.score
		},
		hazardH: hazardHours(points, zones)
	};
}
/** D35 — l'ordre des priorités d'une LIGNE de la grille (comme orderFor) : le profil choisi garde le sien, « perso » le Personnalisé. */
function rowOrderOf(row, prefs) {
	if (row === prefs?.profile) return prefs.order;
	if (row === "perso") return prefs?.custom?.order || prefs?.order || PRESETS.prudent;
	return PRESETS[row] || PRESETS.prudent;
}
/** D35 — les poids du score d'une ligne : ceux du préréglage ; « perso » : `custom.weights`, sinon ceux du préréglage de son ordre. */
var rowWeightsOf = (row, prefs) => weightsFor(row, {
	customWeights: row === "perso" ? prefs?.custom?.weights : null,
	order: rowOrderOf(row, prefs)
});
/** Un ordre de priorités → le score qui lui ressemble (Personnalisé) : son PREMIER critère. */
function scoreKindFor(order = []) {
	for (const it of order) {
		if (it === "margin" || it === "day") return "prudent";
		if (it === "comfort") return "confort";
		if (it === "motor" || it === "sail") return "voile";
		if (it === "fast") return "rapide";
	}
	return "prudent";
}
function cellScore(kind, c, { windowStartMs, crew }) {
	const cr = crew || crewOf({});
	const arrH = (c.dayArrivalMs - windowStartMs) / 36e5;
	if (kind === "rapide") return {
		score: r1(arrH),
		rank: [arrH],
		parts: { arrivalH: r1(arrH) }
	};
	if (kind === "voile") return {
		score: 100 - c.sailPct,
		rank: [
			100 - c.sailPct,
			c.litres,
			arrH
		],
		parts: {
			sailPct: c.sailPct,
			litres: c.litres
		}
	};
	if (kind === "confort") {
		const parts = {
			h20: c.h20,
			hWave2: c.hWave2,
			upwind: r1(.5 * c.upwindH),
			nights: r1(cr.nightH * c.nights),
			fatigue: r1((c.fatigue?.overH || 0) + (c.fatigue?.restedH || 0))
		};
		const s = Object.values(parts).reduce((a, b) => a + (b || 0), 0);
		return {
			score: r1(s),
			rank: [r1(s), arrH],
			parts
		};
	}
	const bucket = Math.floor(Math.max(0, c.marginPct) / 5) * 5;
	return {
		score: -bucket,
		rank: [
			-bucket,
			c.day ? 0 : 1,
			c.fatigue?.score || 0,
			arrH
		],
		parts: {
			marginPct: c.marginPct,
			bucket,
			day: c.day,
			fatigue: c.fatigue?.score || 0
		}
	};
}
var lexLess = (a, b) => {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x < y - 1e-9) return true;
		if (x > y + 1e-9) return false;
	}
	return false;
};
/**
* La couleur d'une case (pur) : gris = pas de route (hors limites, trop long,
* garde-fou) ou arrivée de nuit quand le jour est une priorité ; rouge = près
* des limites (≥ 90 % de celles de B&C) ou la réserve de gazole entamée ;
* ambre = au-delà de la marge (80 %) ; vert sinon.
*/
function cellClass(c, { wantsDay, marginScale = .8 }) {
	if (!c?.ok) return {
		cls: "grey",
		why: c?.reason || "blocked"
	};
	if (wantsDay && !c.day) return {
		cls: "grey",
		why: "night"
	};
	if (c.limitRatio >= .9) return {
		cls: "red",
		why: "nearLimits"
	};
	if (c.intoReserve) return {
		cls: "red",
		why: "fuel"
	};
	if (c.limitRatio > marginScale + 1e-9) return {
		cls: "amber",
		why: "beyondMargin"
	};
	return {
		cls: "green",
		why: null
	};
}
/** La case ★ d'une ligne (pur) : le meilleur score parmi les cases vertes / ambres / rouges ; sinon parmi les grises avec route. */
function bestOfRow(cells) {
	let best = -1;
	const pick = (ok) => {
		for (let i = 0; i < cells.length; i++) {
			const c = cells[i];
			if (!c?.ok || !ok(c)) continue;
			if (best < 0 || lexLess(c.rank, cells[best].rank)) best = i;
		}
	};
	pick((c) => c.cls !== "grey");
	if (best < 0) pick(() => true);
	return best < 0 ? null : best;
}
/** Une ligne en [lon, lat] au 1e-4°, les points ALIGNÉS fusionnés (écart < 2 m) — la même géométrie, plus légère (pur). */
function compactLine(points, tolNm = .001) {
	const q = points.map((p) => [Math.round(p.lon * 1e4) / 1e4, Math.round(p.lat * 1e4) / 1e4]);
	if (q.length < 3) return q;
	const out = [q[0]];
	const dev = (a, b, p) => {
		const k = Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
		const ax = a[0] * 60 * k;
		const ay = a[1] * 60;
		const bx = b[0] * 60 * k - ax;
		const by = b[1] * 60 - ay;
		const px = p[0] * 60 * k - ax;
		const py = p[1] * 60 - ay;
		const L = Math.hypot(bx, by) || 1e-9;
		const tt = (px * bx + py * by) / (L * L);
		if (tt < 0 || tt > 1) return Infinity;
		return Math.abs(px * by - py * bx) / L;
	};
	let anchor = 0;
	for (let i = 2; i < q.length; i++) {
		let ok = true;
		for (let j = anchor + 1; j < i; j++) if (dev(q[anchor], q[i], q[j]) > tolNm) {
			ok = false;
			break;
		}
		if (!ok) {
			out.push(q[i - 1]);
			anchor = i - 1;
		}
	}
	out.push(q.at(-1));
	return out;
}
/** Le contrôle EXACT d'une ligne [[lon, lat]] : côte, dispositifs, dangers évités (le même qu'assertLinesAtSea). → null | 'land' | 'tss' | 'hazard' */
function lineAtSea(line, { coastIndex, zones = null, hazards = null }) {
	const pts = line.map((p) => ({
		lon: p[0],
		lat: p[1]
	}));
	if (coastIndex && coastIndex.firstCrossing(pts) >= 0) return "land";
	for (let j = 1; j < pts.length; j++) {
		if (zones && zones.blocks(pts[j - 1], pts[j])) return "tss";
		if (hazards && hazards.blocks(pts[j - 1], pts[j])) return "hazard";
	}
	return null;
}
/** L'accord des modèles LE LONG d'une route (les points ●/◐/○ de D11) → { level, ok, partial, disagree } (pur). */
function agreeLevel(counts) {
	const known = counts.accord + counts.partiel + counts["désaccord"];
	if (!known) return {
		level: "faible",
		ok: 0,
		partial: 0,
		disagree: 0
	};
	const okS = counts.accord / known;
	return {
		level: counts["désaccord"] / known > .2 || okS < .4 ? "faible" : okS >= .7 && !counts["désaccord"] ? "élevée" : "moyenne",
		ok: counts.accord,
		partial: counts.partiel,
		disagree: counts["désaccord"]
	};
}
/** Une file à concurrence bornée, avec une heure limite et un arrêt (annulation). */
async function runQueue(jobs, { concurrency, deadlineMs, shouldStop, run, onDone }) {
	let next = 0;
	let stopped = false;
	const worker = async () => {
		for (;;) {
			if (next >= jobs.length) return;
			const j = jobs[next++];
			if (stopped || shouldStop && shouldStop()) {
				stopped = true;
				j.skip = "cancelled";
				continue;
			}
			if (Date.now() > deadlineMs) {
				j.skip = "time";
				continue;
			}
			try {
				j.out = await run(j);
			} catch (e) {
				j.out = {
					ok: false,
					reason: "error",
					error: String(e?.message || e)
				};
			}
			onDone?.(j);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
	return stopped;
}
/**
* L'OPTIMISEUR DE DÉPART. ctx (du conseil) = { stops, to, bbox, grids, waves, land, coast, forbidden, forbiddenMask,
*   coastIndex, polar, limits (de B&C + réglages), rapideLimits, prefs, astarModel, refModel, threads, alongRows,
*   isNight, arrivalLight, avoid (anneaux évités), motorKn, fuel: { lph, aboardL, reserveL }, orderFor, wantsDay, marginScale, departMs,
*   reuse: { rapide: route | null, astar: { [key]: route } } }
* → le bloc `bestDeparture` du résultat.
*/
async function bestDeparture(ctx, { windowH = 48, stepH = 3, budgetMs = 24e4, onStep = () => {}, shouldStop = null, passageH = null, rows: onlyRows = null } = {}) {
	const t0 = Date.now();
	const deadlineMs = t0 + budgetMs;
	const grid = ctx.grids[ctx.astarModel];
	const win = departureWindow({
		departMs: ctx.departMs,
		horizonMs: grid.times.at(-1),
		passageH,
		askedH: windowH,
		stepH
	});
	const deps = win.deps;
	const allRows = [...DEP_ROWS, ...ctx.prefs.custom || ctx.prefs.profile === "perso" ? ["perso"] : []];
	const pick = Array.isArray(onlyRows) ? allRows.filter((r) => onlyRows.includes(r)) : [];
	const rows = pick.length ? pick : allRows;
	const orders = {
		confort: firstPassOrder(ctx.orderFor("confort", ctx.prefs)),
		prudent: firstPassOrder(ctx.orderFor("prudent", ctx.prefs)),
		voile: "sail",
		rapide: "isochrones",
		...rows.includes("perso") ? { perso: firstPassOrder(ctx.orderFor("perso", ctx.prefs)) } : {}
	};
	const kinds = {
		confort: "confort",
		voile: "voile",
		rapide: "rapide",
		prudent: "prudent",
		perso: scoreKindFor(ctx.prefs.custom?.order || ctx.prefs.order)
	};
	const cells = Object.fromEntries(rows.map((r) => [r, deps.map(() => null)]));
	const zonesX = exactZones(ctx.forbidden);
	const hazX = ctx.avoid?.length ? exactZones(ctx.avoid) : null;
	const crew = crewOf(ctx.limits);
	const colOrder = coarseToFine(deps.length);
	const isoJobs = [];
	const astarJobs = [];
	for (const ci of colOrder) for (const row of rows) {
		const j = {
			row,
			ci,
			dep: deps[ci]
		};
		if (ci === 0 && row === "rapide" && ctx.reuse?.rapide) {
			j.out = ctx.reuse.rapide;
			j.reused = true;
		} else if (ci === 0 && ctx.reuse?.astar?.[row]?.ok && ctx.reuse.astarOrders?.[row] && firstPassOrder(ctx.reuse.astarOrders[row]) === orders[row]) {
			j.out = ctx.reuse.astar[row];
			j.reused = true;
		}
		(row === "rapide" ? isoJobs : astarJobs).push(j);
	}
	const total = isoJobs.length + astarJobs.length;
	let done = 0;
	const tick = () => onStep({
		name: "bestDeparture",
		done,
		total
	});
	tick();
	const nIso = 1;
	const nA = Math.max(1, ctx.threads || 1);
	const makePool = ctx.createPool || createPool;
	const isoPool = makePool(new URL("./routeWorker.mjs", import.meta.url), {
		polar: ctx.polar,
		grids: ctx.grids,
		waves: ctx.waves,
		land: ctx.land.data,
		coast: ctx.coast.data,
		forbidden: ctx.forbidden,
		forbiddenMask: ctx.forbiddenMask.data,
		coastIndex: ctx.coastIndex?.data,
		limits: ctx.rapideLimits
	}, nIso);
	const aPool = astarJobs.some((j) => !j.out) ? makePool(new URL("./graphWorker.mjs", import.meta.url), {
		polar: ctx.polar,
		grids: { [ctx.astarModel]: grid },
		waves: ctx.waves,
		land: ctx.land.data,
		coast: ctx.coast?.data || null,
		forbidden: ctx.forbidden,
		forbiddenMask: ctx.forbiddenMask?.data || null,
		coastIndex: ctx.coastIndex?.data || null,
		bbox: ctx.bbox,
		limits: ctx.limits
	}, nA) : null;
	let cancelled = false;
	const slowPct = voileSlowPctOf(ctx.prefs);
	const rapideOf = /* @__PURE__ */ new Map();
	const rapideP = (ci) => {
		if (!rapideOf.has(ci)) {
			let settle;
			const p = new Promise((r) => {
				settle = r;
			});
			p.settle = settle;
			rapideOf.set(ci, p);
		}
		return rapideOf.get(ci);
	};
	try {
		const onDone = () => {
			done++;
			tick();
		};
		const [c1, c2] = await Promise.all([runQueue(isoJobs, {
			concurrency: nIso,
			deadlineMs,
			shouldStop,
			onDone,
			run: async (j) => {
				try {
					const out = j.out ? j.out : await isoPool.run({
						model: ctx.astarModel,
						stops: ctx.stops,
						departMs: j.dep
					});
					rapideP(j.ci).settle(out);
					return out;
				} catch (e) {
					rapideP(j.ci).settle(null);
					throw e;
				}
			}
		}).finally(() => {
			deps.forEach((_d, ci) => rapideP(ci).settle(null));
		}), runQueue(astarJobs, {
			concurrency: nA,
			deadlineMs,
			shouldStop,
			onDone,
			run: async (j) => {
				if (j.out) return j.out;
				const rap = j.row === "voile" && slowPct != null ? await rapideP(j.ci) : null;
				return aPool.run({
					model: ctx.astarModel,
					stops: ctx.stops,
					departMs: j.dep,
					profile: null,
					order: orders[j.row],
					options: {
						policy: j.row === "voile" || /motor:/.test(orders[j.row]) ? "choice" : "crew",
						deadlineMs,
						maxHours: 400,
						...rap?.ok ? { slowCap: {
							pct: slowPct,
							refHours: rap.hours
						} } : {}
					}
				});
			}
		})]);
		cancelled = c1 || c2;
	} finally {
		if (aPool) await aPool.close();
	}
	for (const j of [...isoJobs, ...astarJobs]) {
		const r = j.out;
		if (!r) {
			cells[j.row][j.ci] = {
				ok: false,
				dep: j.dep,
				reason: j.skip === "cancelled" ? "cancelled" : "time"
			};
			continue;
		}
		if (!r.ok) {
			cells[j.row][j.ci] = {
				ok: false,
				dep: j.dep,
				reason: r.reason === "time" ? "time" : r.short ? "short" : r.reason === "error" ? "error" : "blocked"
			};
			continue;
		}
		const line = compactLine(r.points);
		const bad = lineAtSea(line, {
			coastIndex: ctx.coastIndex,
			zones: zonesX,
			hazards: hazX
		});
		if (bad) {
			cells[j.row][j.ci] = {
				ok: false,
				dep: j.dep,
				reason: "guard",
				guard: bad
			};
			continue;
		}
		const st = cellStats(r.points, {
			L: ctx.limits,
			to: ctx.to,
			isNight: ctx.isNight,
			arrivalLight: ctx.arrivalLight,
			waitH: r.waitH || 0,
			fuelLph: ctx.fuel.lph,
			fuelAboardL: ctx.fuel.aboardL,
			fuelReserveL: ctx.fuel.reserveL
		});
		const counts = {
			accord: 0,
			partiel: 0,
			"désaccord": 0,
			inconnu: 0
		};
		ctx.alongRows(r.points, r.points.at(-1).t, counts, j.dep);
		const c = {
			ok: true,
			dep: j.dep,
			...st,
			agree: agreeLevel(counts),
			line,
			...j.reused ? { reused: true } : {},
			...r.relaxed?.length ? { relaxed: r.relaxed } : {},
			...r.slowCap ? { slowCap: r.slowCap } : {}
		};
		if (Array.isArray(ctx.zones)) c.hazardH = hazardHours(r.points, ctx.zones);
		const sc = cellScore(kinds[j.row], c, {
			windowStartMs: deps[0],
			crew
		});
		Object.assign(c, {
			score: sc.score,
			rank: sc.rank,
			parts: sc.parts
		}, cellClass(c, {
			wantsDay: ctx.wantsDay,
			marginScale: ctx.marginScale
		}));
		c.points = r.points;
		cells[j.row][j.ci] = c;
	}
	const best = Object.fromEntries(rows.map((r) => [r, bestOfRow(cells[r])]));
	const scoring = scoringOf(cells, rows, ctx.prefs, r1(crew.nightH));
	for (const r of rows) for (const c of cells[r]) {
		if (!c?.ok) continue;
		const s = scoreCell(c, scoring.weights[r], scoring.ctx);
		c.score100 = s.ok ? Math.round(s.score * 10) / 10 : null;
		if (!s.ok) c.scoreWhy = s.why;
	}
	const bestScore = Object.fromEntries(rows.map((r) => [r, bestByScore(cells[r], scoring.weights[r], scoring.ctx, { dayFilter: scoring.dayFilter[r] })]));
	const stars = [];
	for (const r of rows) {
		if (best[r] != null) stars.push({
			r,
			i: best[r],
			kind: bestScore[r] === best[r] ? "both" : "engine"
		});
		if (bestScore[r] != null && bestScore[r] !== best[r]) stars.push({
			r,
			i: bestScore[r],
			kind: "score"
		});
	}
	const starDeps = [...new Set([...stars.filter((s) => s.kind !== "score"), ...stars.filter((s) => s.kind === "score")].map((s) => s.i))];
	const others = Object.keys(ctx.grids).filter((m) => m !== ctx.astarModel);
	const spreadOf = {};
	const spreadWhy = {};
	if (!cancelled && starDeps.length && others.length && Date.now() < deadlineMs - 1e4) {
		const jobs = starDeps.flatMap((ci) => ci === 0 && ctx.reuse?.models ? [] : others.map((m) => ({
			ci,
			m,
			dep: deps[ci]
		})));
		let n2 = 0;
		const tot2 = jobs.length;
		if (tot2) {
			onStep({
				name: "bestDeparture-models",
				done: 0,
				total: tot2
			});
			await runQueue(jobs, {
				concurrency: nIso,
				deadlineMs,
				shouldStop,
				run: (j) => isoPool.run({
					model: j.m,
					stops: ctx.stops,
					departMs: j.dep
				}),
				onDone: () => onStep({
					name: "bestDeparture-models",
					done: ++n2,
					total: tot2
				})
			});
		}
		for (const ci of starDeps) {
			const mine = ci === 0 && ctx.reuse?.models ? ctx.reuse.models : Object.fromEntries(jobs.filter((j) => j.ci === ci && j.out).map((j) => [j.m, j.out]));
			const skipped = jobs.filter((j) => j.ci === ci && j.skip);
			if (skipped.length) spreadWhy[ci] = skipped.some((j) => j.skip === "cancelled") ? "cancelled" : "time";
			if (!Object.keys(mine).length) continue;
			spreadOf[ci] = mine;
		}
	} else for (const ci of starDeps) spreadWhy[ci] = cancelled ? "cancelled" : !others.length ? "single" : "time";
	await isoPool.close();
	const statsOpts = {
		L: ctx.limits,
		to: ctx.to,
		isNight: ctx.isNight,
		arrivalLight: ctx.arrivalLight,
		fuelLph: ctx.fuel.lph,
		fuelAboardL: ctx.fuel.aboardL,
		fuelReserveL: ctx.fuel.reserveL,
		zones: ctx.zones
	};
	const spread = {};
	for (const [ci, mine] of Object.entries(spreadOf)) spread[ci] = Object.fromEntries(Object.entries(mine).map(([m, x]) => [m, x?.ok ? {
		ok: true,
		arrivalMs: x.arrivalMs,
		bilan: bilanOf(x.points, statsOpts)
	} : {
		ok: false,
		short: Boolean(x?.short),
		reason: x?.short ? "short" : "blocked"
	}]));
	for (const { r, i, kind } of stars) {
		const c = cells[r][i];
		const mine = spreadOf[i];
		if (!mine) c.conf = {
			level: c.agree.level,
			partial: true,
			...spreadWhy[i] ? { why: spreadWhy[i] } : {}
		};
		else {
			const okM = Object.entries(mine).filter(([, x]) => x?.ok);
			const etas = [c.arrivalMs, ...okM.map(([, x]) => x.arrivalMs)].sort((a, b) => a - b);
			const spreadH = (etas.at(-1) - etas[0]) / 36e5;
			let lat = 0;
			for (const [, x] of okM) lat = Math.max(lat, lateralNm(c.points, x.points) || 0);
			const routed = okM.length + 1;
			const sLevel = spreadH > 18 ? "faible" : spreadH > 6 ? "moyenne" : "élevée";
			const lLevel = lat > 150 ? "faible" : lat > 60 ? "moyenne" : "élevée";
			const rLevel = routed < 2 ? "faible" : Object.keys(mine).length + 1 - routed > 0 ? worst$1(sLevel, lLevel, "moyenne") : worst$1(sLevel, lLevel);
			c.conf = {
				level: worst$1(c.agree.level, rLevel),
				along: c.agree.level,
				routes: rLevel,
				spreadH: r1(spreadH),
				lateralNm: Math.round(lat),
				routed,
				models: Object.keys(mine).length + 1,
				minMs: etas[0],
				maxMs: etas.at(-1),
				...spreadWhy[i] ? { why: spreadWhy[i] } : {}
			};
		}
		c.detail = {
			star: kind,
			...starDetail(c, r, ctx, {
				zones: zonesX,
				hazards: hazX
			})
		};
	}
	for (const r of rows) for (const c of cells[r]) if (c) delete c.points;
	const timedOut = rows.reduce((s, r) => s + cells[r].filter((c) => c && !c.ok && c.reason === "time").length, 0);
	return {
		v: 1,
		model: ctx.astarModel,
		windowH: win.windowH,
		askedH: win.askedH,
		maxH: win.maxH,
		clamped: win.clamped,
		stepH,
		deps,
		rows,
		orders,
		kinds,
		cells,
		best,
		bestScore,
		scoring,
		spread,
		chosen: ctx.prefs.profile === "perso" ? "perso" : ctx.prefs.profile === "voile" ? "voile" : ctx.prefs.profile,
		wantsDay: Boolean(ctx.wantsDay),
		marginPct: Math.round(ctx.marginScale * 100),
		crewNightH: r1(crew.nightH),
		...slowPct != null ? { voileSlowPct: slowPct } : {},
		ms: Date.now() - t0,
		budgetS: Math.round(budgetMs / 1e3),
		timedOut,
		cancelled,
		...rows.length < allRows.length ? { rowsOf: allRows } : {}
	};
}
/**
* D35 (RR-S) — le contexte du score d'une grille (pur) : la case la plus courte
* en mer de toutes les lignes, les heures d'une nuit, la marge de B&C ; par
* ligne, ses poids et son filtre « jour » (décision 3 : `day` dans SES priorités).
* → { v, ctx, weights: { ligne: poids }, dayFilter: { ligne: bool } }
*/
function scoringOf(cells, rows, prefs, crewNightH) {
	return {
		v: 1,
		ctx: scoreContext(cells, {
			crewNightH,
			marginPct: prefs?.marginPct
		}),
		weights: Object.fromEntries(rows.map((r) => [r, rowWeightsOf(r, prefs)])),
		dayFilter: Object.fromEntries(rows.map((r) => [r, dayFilterFor(rowOrderOf(r, prefs))]))
	};
}
/** D35 — l'écart permis entre l'heure lue sur `lineT` (linéaire entre deux sommets) et celle de la route. */
var LINE_T_TOL_MS = 5 * 6e4;
/**
* D35 (RR-M) — LE TRAIT HORODATÉ LÉGER (pur) : l'heure de chaque sommet de la
* ligne compacte `line` (compactLine(points) — la géométrie DÉJÀ contrôlée et
* dessinée), exacte au sommet ; entre deux sommets la route est droite (à 2 m)
* et l'heure linéaire. → [t] (même longueur que `line`, ms entières), ou null
* si, quelque part, l'heure linéaire s'écarte de plus de `tolMs` de celle de la
* route (une vitesse qui change au milieu d'une ligne droite : voile ↔ moteur).
*/
function vertexTimes(line, points, tolMs = LINE_T_TOL_MS) {
	if (!Array.isArray(line) || !Array.isArray(points) || line.length < 2 || points.length < 2) return null;
	const q = points.map((p) => [Math.round(p.lon * 1e4) / 1e4, Math.round(p.lat * 1e4) / 1e4]);
	const idx = [];
	let k = 0;
	for (const v of line) {
		while (k < q.length && (q[k][0] !== v[0] || q[k][1] !== v[1])) k++;
		if (k >= q.length) return null;
		idx.push(k);
		k++;
	}
	idx[idx.length - 1] = q.length - 1;
	for (let s = 0; s < idx.length - 1; s++) {
		const a = idx[s];
		const z = idx[s + 1];
		const A = q[a];
		const Z = q[z];
		const kx = Math.cos((A[1] + Z[1]) / 2 * Math.PI / 180);
		const dx = (Z[0] - A[0]) * kx;
		const dy = Z[1] - A[1];
		const L2 = dx * dx + dy * dy;
		const dt = points[z].t - points[a].t;
		for (let j = a + 1; j < z; j++) {
			const f = L2 > 0 ? ((q[j][0] - A[0]) * kx * dx + (q[j][1] - A[1]) * dy) / L2 : (points[j].t - points[a].t) / (dt || 1);
			if (Math.abs(points[a].t + dt * f - points[j].t) > tolMs) return null;
		}
	}
	return idx.map((j) => Math.round(points[j].t));
}
/**
* D35 (RR-M) — le détail d'une case ★ (la route `c.points` encore là) :
*  · la case de la colonne 0 REPRISE du conseil → `same` (le détail y est déjà :
*    'reference' = `result.rows` + `result.route` ; 'profile:<k>' = `profiles[k]`) ;
*  · sinon `rows` (alongRows, la forme de `profiles[k].rows`, depuis SON départ) ;
*    le trait horodaté : `lineT` (l'heure de chaque sommet de `c.line`, à 5 min
*    près entre deux sommets — vertexTimes) ou, si ce n'est pas tenable, `line`
*    [[lon, lat, t]] (chaque point, au 1e-4°, comme `profiles[k].line`) passé au
*    contrôle EXACT (lineAtSea ; refusé : pas de trait, `lineGuard`) puis au
*    dernier garde-fou ; `modes` (les tranches moteur / voile, comme `profiles[k].modes`).
*/
function starDetail(c, row, ctx, { zones, hazards }) {
	if (c.reused) return { same: row === "rapide" ? "reference" : `profile:${row}` };
	const pts = c.points;
	const out = { rows: ctx.alongRows(pts, pts.at(-1).t, null, c.dep) };
	const lineT = vertexTimes(c.line, pts);
	if (lineT) out.lineT = lineT;
	else {
		const line = pts.map((p) => [
			Math.round(p.lon * 1e4) / 1e4,
			Math.round(p.lat * 1e4) / 1e4,
			Math.round(p.t)
		]);
		const bad = lineAtSea(line, {
			coastIndex: ctx.coastIndex,
			zones,
			hazards
		});
		if (bad) out.lineGuard = bad;
		else out.line = line;
	}
	if (ctx.modeSpans) out.modes = ctx.modeSpans(pts);
	return out;
}
/**
* Toutes les lignes tracées de la grille (pour le dernier garde-fou) : { 'dep:<ligne>:<colonne>': [[lon, lat]] }.
* D35 : aussi le trait horodaté du détail d'une ★ ('dep:<ligne>:<colonne>:detail', [[lon, lat, t]]).
*/
function departureLines(block) {
	const out = {};
	for (const r of block?.rows || []) (block.cells?.[r] || []).forEach((c, i) => {
		if (c?.ok && Array.isArray(c.line) && c.line.length > 1) out[`dep:${r}:${i}`] = c.line;
		if (c?.ok && Array.isArray(c.detail?.line) && c.detail.line.length > 1) out[`dep:${r}:${i}:detail`] = c.detail.line;
	});
	return out;
}
var MAX_BINS = 40;
var isNum = (x) => typeof x === "number" && Number.isFinite(x);
var increasing = (a, lo, hi) => Array.isArray(a) && a.length >= 2 && a.length <= MAX_BINS && a.every((x, i) => isNum(x) && x >= lo && x <= hi && (i === 0 || x > a[i - 1]));
/** Une table [tws][twa] de la bonne taille, chaque vitesse dans ]0, 30[ (pas de NaN, pas de null). → null | raison */
function tableIssue(t, nTws, nTwa, name) {
	if (!Array.isArray(t) || t.length !== nTws) return `${name} : ${Array.isArray(t) ? t.length : "pas"} lignes au lieu de ${nTws}`;
	for (let i = 0; i < nTws; i++) {
		const row = t[i];
		if (!Array.isArray(row) || row.length !== nTwa) return `${name}[${i}] : ${Array.isArray(row) ? row.length : "pas de"} colonnes au lieu de ${nTwa}`;
		for (let j = 0; j < nTwa; j++) if (!isNum(row[j]) || !(row[j] > 0 && row[j] < 30)) return `${name}[${i}][${j}] = ${row[j]} hors de ]0, 30[`;
	}
	return null;
}
/**
* Ce qui ne va pas dans une polaire (la forme du fichier du routeur), ou null.
* Vérifie : TWS_BINS / TWA_BINS croissants et plausibles ; `mixed.table` de
* leur taille, chaque vitesse un nombre dans ]0, 30[ ; si présentes, la
* confiance par case (même taille, measured | blended | escale) et l'axe des
* vagues du lot 3 (HS_BINS croissants, `mixed.tableHs[hs][tws][twa]` de même).
* Les autres clés (calibration, learned, bySail, loch…) ne sont pas lues par
* le moteur pour router : tolérées telles quelles.
*/
function polarShapeIssue(P) {
	if (!P || typeof P !== "object" || Array.isArray(P)) return "pas un objet";
	if (!increasing(P.TWS_BINS, 0, 80)) return "TWS_BINS invalides";
	if (!increasing(P.TWA_BINS, 0, 180)) return "TWA_BINS invalides";
	const nTws = P.TWS_BINS.length;
	const nTwa = P.TWA_BINS.length;
	const t = tableIssue(P.mixed?.table, nTws, nTwa, "mixed.table");
	if (t) return t;
	const conf = P.calibration?.confidence;
	if (conf != null) {
		if (!Array.isArray(conf) || conf.length !== nTws || conf.some((r) => !Array.isArray(r) || r.length !== nTwa || r.some((c) => ![
			"measured",
			"blended",
			"escale"
		].includes(c)))) return "calibration.confidence invalide";
	}
	if (P.HS_BINS != null || P.mixed?.tableHs != null) {
		if (!increasing(P.HS_BINS, 0, 20)) return "HS_BINS invalides";
		const th = P.mixed?.tableHs;
		if (!Array.isArray(th) || th.length !== P.HS_BINS.length) return "mixed.tableHs : pas une table par Hs";
		for (let h = 0; h < th.length; h++) {
			const e = tableIssue(th[h], nTws, nTwa, `mixed.tableHs[${h}]`);
			if (e) return e;
		}
	}
	return null;
}
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var iso = (v) => {
	const t = Date.parse(v || "");
	return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/**
* La polaire telle que le moteur la reçoit : le fichier, plus SA version
* (`polarVersion` — une clé que le fichier n'a pas ; computeAdvice ne lit que
* la table, la confiance et les cases). source : 'db' (la version active en
* base), 'bundled' (le fichier embarqué), 'file' (--polar du PC du bord).
*/
function withVersion(data, { id = null, label = null, builtAt = null, source = "db", cached = false } = {}) {
	return {
		...data,
		polarVersion: {
			id: id && UUID.test(id) ? id : null,
			label: label || null,
			builtAt: iso(builtAt) || iso(data?.builtAt),
			source,
			...cached ? { cached: true } : {}
		}
	};
}
/** Ce que `result.polar` dit de la version (computeAdvice) : { versionId, label, source } — le fichier embarqué si rien n'est dit. */
function polarVersionBlock(P) {
	const v = P?.polarVersion;
	if (!v) return {
		versionId: null,
		label: null,
		source: "bundled"
	};
	return {
		versionId: v.id || null,
		label: v.label || null,
		source: v.source || "bundled",
		...v.cached ? { cached: true } : {}
	};
}
var REACH_GC_GAP_NM = .05;
var RAD = Math.PI / 180;
var mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2)) / RAD;
var unMercY = (y) => (2 * Math.atan(Math.exp(y * RAD)) - Math.PI / 2) / RAD;
/** La longitude de b ramenée à moins de 180° de a (l'antiméridien). */
var unwrap = (a, b) => {
	let d = b.lon - a.lon;
	while (d > 180) d -= 360;
	while (d < -180) d += 360;
	return a.lon + d;
};
var wrap = (lon) => ((lon + 180) % 360 + 360) % 360 - 180;
/** La loxodromie a → b, en n + 1 points (droite sur la carte de Mercator). */
function rhumbPath(a, b, stepNm = 6) {
	const n = Math.max(1, Math.ceil(distNm(a, b) / stepNm));
	const y0 = mercY(a.lat);
	const y1 = mercY(b.lat);
	const bl = unwrap(a, b);
	const out = [];
	for (let s = 0; s <= n; s++) {
		const f = s / n;
		out.push({
			lat: Math.abs(y1 - y0) < 1e-12 ? a.lat + (b.lat - a.lat) * f : unMercY(y0 + (y1 - y0) * f),
			lon: wrap(a.lon + (bl - a.lon) * f)
		});
	}
	return out;
}
/** L'orthodromie a → b, en n + 1 points. */
function gcPath(a, b, stepNm = 6) {
	const d = distNm(a, b);
	const n = Math.max(1, Math.ceil(d / stepNm));
	const v = (p) => [
		Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD),
		Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD),
		Math.sin(p.lat * RAD)
	];
	const A = v(a);
	const B = v(b);
	const om = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
	if (om < 1e-12) return [a, b];
	const out = [];
	for (let s = 0; s <= n; s++) {
		const f = s / n;
		const k1 = Math.sin((1 - f) * om) / Math.sin(om);
		const k2 = Math.sin(f * om) / Math.sin(om);
		const x = k1 * A[0] + k2 * B[0];
		const y = k1 * A[1] + k2 * B[1];
		const z = k1 * A[2] + k2 * B[2];
		out.push({
			lat: Math.atan2(z, Math.hypot(x, y)) / RAD,
			lon: Math.atan2(y, x) / RAD
		});
	}
	return out;
}
/** L'écart (milles) entre l'orthodromie et la loxodromie, au milieu. */
function gcRhumbGapNm(a, b) {
	const r = rhumbPath(a, b, Math.max(1, distNm(a, b) / 2));
	const g = gcPath(a, b, Math.max(1, distNm(a, b) / 2));
	return distNm(r[Math.floor(r.length / 2)], g[Math.floor(g.length / 2)]);
}
/**
* L'écart (milles) du point p à la loxodromie a → b (une droite sur Mercator,
* conforme : à l'échelle locale, 1° de carte = 60 · cos(lat) milles).
*/
function rhumbDevNm(a, b, p) {
	const ax = a.lon;
	const ay = mercY(a.lat);
	const bx = unwrap(a, b);
	const by = mercY(b.lat);
	const px = unwrap(a, p);
	const py = mercY(p.lat);
	const dx = bx - ax;
	const dy = by - ay;
	const L2 = dx * dx + dy * dy;
	const s = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
	const fy = ay + s * dy;
	return Math.hypot(px - (ax + s * dx), py - fy) * 60 * Math.cos(unMercY(fy) * RAD);
}
/** Une branche a → b passe-t-elle le prédicat `clear(p, q)`, morceau par morceau ? */
function chordClear(a, b, clear, { stepNm = 6, gcGapNm = REACH_GC_GAP_NM } = {}) {
	const paths = [rhumbPath(a, b, stepNm)];
	if (gcRhumbGapNm(a, b) > gcGapNm) paths.push(gcPath(a, b, stepNm));
	for (const p of paths) for (let s = 1; s < p.length; s++) if (!clear(p[s - 1], p[s])) return false;
	return true;
}
/**
* line : [[lon, lat, t]…] (la ligne telle que l'app la reçoit) ; stops : les
* arrêts de la chaîne [départ, portes…, arrivée] ; clearFor(a, b) → le
* prédicat (p, q) => boolean de la jambe entre stops[a] et stops[b] (une
* porte introuvable sur la ligne : la jambe va d'une porte trouvée à la
* suivante, et ses abords ne sont pas relâchés — plus strict, jamais moins) ;
* guardFor(a, b) → le prédicat du dernier garde-fou (côte exacte croisée,
* dispositifs, dangers évités), pour des sommets alignés (REACH_ALIGNED_NM).
* → reach : un entier par sommet (≥ i + 1 ; n − 1 au dernier).
*/
function legReach(line, { stops = [], clearFor, guardFor = null, capH = 48, capN = 96, stepNm = 6 } = {}) {
	const pts = (line || []).map((q) => Array.isArray(q) ? {
		lon: q[0],
		lat: q[1],
		t: q[2]
	} : q);
	const n = pts.length;
	if (n < 2) return n ? [0] : [];
	const cuts = [{
		idx: 0,
		stop: 0
	}];
	stops.slice(1, -1).forEach((s, k) => {
		let bi = -1;
		let bd = Infinity;
		for (let i = 0; i < n; i++) {
			const d = distNm(pts[i], s);
			if (d < bd) {
				bd = d;
				bi = i;
			}
		}
		if (bi > 0 && bi < n - 1 && bd <= 1 && bi > cuts.at(-1).idx) cuts.push({
			idx: bi,
			stop: k + 1
		});
	});
	cuts.push({
		idx: n - 1,
		stop: Math.max(1, stops.length - 1)
	});
	const reach = new Array(n);
	reach[n - 1] = n - 1;
	for (let i = 0; i < n - 1; i++) {
		let leg = 0;
		while (leg < cuts.length - 2 && i >= cuts[leg + 1].idx) leg++;
		const end = cuts[leg + 1].idx;
		const clear = clearFor ? clearFor(cuts[leg].stop, cuts[leg + 1].stop) : null;
		const guard = guardFor ? guardFor(cuts[leg].stop, cuts[leg + 1].stop) : null;
		let r = i + 1;
		if (clear) for (let j = i + 2; j <= end && j - i <= capN; j++) {
			if (Number.isFinite(pts[j].t) && Number.isFinite(pts[i].t) && pts[j].t - pts[i].t > capH * 36e5) break;
			let aligned = true;
			for (let k = i + 1; k < j && aligned; k++) if (rhumbDevNm(pts[i], pts[j], pts[k]) > .01) aligned = false;
			if (!chordClear(pts[i], pts[j], aligned && guard ? guard : clear, { stepNm })) break;
			r = j;
		}
		reach[i] = r;
	}
	return reach;
}
var STEPS = [
	"places",
	"charts",
	"weather",
	"reference",
	"models",
	"along",
	"checks",
	"optimiser",
	"polar",
	"departures",
	"ensembles-weather",
	"ensembles",
	"bestDeparture",
	"bestDeparture-models",
	"crew"
];
/** D22 — le budget de l'optimiseur de départ (s) ; au-delà, « trop long » dans les cases restantes. */
var BEST_DEPARTURE_BUDGET_MS = 24e4;
var HERE$1 = path.dirname(fileURLToPath(import.meta.url));
var LEVELS = [
	"élevée",
	"moyenne",
	"faible"
];
var worst = (...ls) => LEVELS[Math.max(...ls.map((l) => LEVELS.indexOf(l)))];
/** La prochaine heure pleine (UTC). */
var nextHour = (now = Date.now()) => {
	const d = new Date(now);
	d.setUTCMinutes(0, 0, 0);
	return d.getTime() + 36e5;
};
/** La polaire apprise (data/polar-wangap.json, à côté de lib/) — le REPLI depuis POLAR-005 : le service passe la version active (`polar`). */
function loadPolar(file = path.join(HERE$1, "..", "data", "polar-wangap.json")) {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}
/**
* Le fuseau horaire d'un point (D12 : l'heure locale d'arrivée, signalée quand
* elle diffère de celle du téléphone). Open-Meteo le donne avec `timezone=auto`
* — un nom IANA (« Atlantic/Canary »), que l'app formate avec Intl, heure d'été
* comprise. En cache par point arrondi. null si indisponible.
*/
async function timezoneAt(lat, lon, { cacheDir, offline = false } = {}) {
	const k = `${lat.toFixed(1)}_${lon.toFixed(1)}`;
	const file = cacheDir ? path.join(cacheDir, "tz.json") : null;
	let cache = {};
	try {
		if (file && fs.existsSync(file)) cache = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		cache = {};
	}
	if (cache[k]) return cache[k];
	if (offline) return null;
	try {
		const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1&daily=sunrise`, { signal: AbortSignal.timeout(15e3) });
		if (!r.ok) return null;
		const tz = (await r.json()).timezone || null;
		if (tz && file) {
			cache[k] = tz;
			fs.writeFileSync(file, JSON.stringify(cache));
		}
		return tz;
	} catch {
		return null;
	}
}
/** Le point d'une route à l'instant t (interpolé). */
function at(points, t) {
	if (t <= points[0].t) return points[0];
	if (t >= points[points.length - 1].t) return points[points.length - 1];
	for (let i = 0; i < points.length - 1; i++) if (t <= points[i + 1].t) {
		const f = (t - points[i].t) / (points[i + 1].t - points[i].t);
		return {
			lat: points[i].lat + (points[i + 1].lat - points[i].lat) * f,
			lon: points[i].lon + (points[i + 1].lon - points[i].lon) * f
		};
	}
	return points[points.length - 1];
}
/**
* ROUTE-016 — les tranches moteur / voile d'une route, compactes : le début de
* chaque tranche `[t, 'm' | 'v']` (pur). Le profil de l'écran dessine la bande
* « moteur » d'une route de l'optimiseur comme celle de Rapide.
*/
function modeSpans(points) {
	const out = [];
	for (const p of points || []) {
		const m = p?.mode === "moteur" ? "m" : p?.mode === "voile" ? "v" : null;
		if (!m || !Number.isFinite(p.t)) continue;
		if (!out.length || out.at(-1)[1] !== m) out.push([p.t, m]);
	}
	return out;
}
/**
* ROUTE-016 — l'état de la polaire calibrée (POLAR-001), compté case par case :
* mesurée / mélangée / Escale à l'échelle (pur). Réglages → 🧭 Routage le montre.
*/
function polarCalibration(P) {
	const c = P?.calibration;
	if (!c || !Array.isArray(c.confidence)) return null;
	const n = {
		measured: 0,
		blended: 0,
		escale: 0
	};
	for (const row of c.confidence) for (const v of row || []) if (v in n) n[v]++;
	return {
		method: c.method || null,
		...n,
		cells: n.measured + n.blended + n.escale
	};
}
var isNight = (lat, lon, t) => {
	const s = sunTimes(lat, lon, t);
	return s ? t < s.rise || t > s.set : false;
};
function weatherFreshness(grids = {}, waves = null) {
	const one = (g) => g?.stale ? {
		stale: true,
		ageH: Math.round((Number(g.stale.ageH) || 0) * 10) / 10,
		fetchedAt: g.stale.fetchedAt || g.fetchedAt || null,
		reason: g.stale.reason ? String(g.stale.reason).slice(0, 120) : null
	} : {
		stale: false,
		fetchedAt: g?.fetchedAt || null
	};
	const models = Object.fromEntries(Object.entries(grids).filter(([, g]) => g).map(([m, g]) => [m, one(g)]));
	const w = waves ? one(waves) : null;
	const old = [...Object.values(models), ...w ? [w] : []].filter((x) => x.stale).sort((a, b) => b.ageH - a.ageH);
	return {
		stale: old.length > 0,
		oldestAgeH: old.length ? old[0].ageH : null,
		fetchedAt: old.length ? old[0].fetchedAt : null,
		staleModels: Object.keys(models).filter((m) => models[m].stale),
		wavesStale: Boolean(w?.stale),
		models,
		waves: w,
		reason: old[0]?.reason || null
	};
}
/** Le niveau d'une météo d'avant : « à surveiller » jusqu'à 12 h, mauvais au-delà. */
var staleLevel = (ageH) => Number(ageH) <= 12 ? "mid" : "bad";
/** La fraîcheur des grilles qu'UNE route a lues (son modèle + les vagues) : { stale, ageH } | { stale: false }. */
function routeWeather(weather, model) {
	const parts = [weather?.models?.[model], weather?.waves].filter((x) => x?.stale);
	return parts.length ? {
		stale: true,
		ageH: Math.max(...parts.map((x) => x.ageH))
	} : { stale: false };
}
/**
* LA CONFIANCE UNIQUE (D11) — pure : la plus basse des deux qu'on sait
* calculer, avec toutes les raisons.
*  · l'accord des modèles LE LONG de la route (points d'accord / partiels /
*    désaccord ; sous 8 nds la direction ne compte pas — agreement()) ;
*  · l'étalement des ROUTES (heures d'arrivée, écart latéral, modèles bloqués).
* Une prévision trop courte ne baisse rien (elle est dite, niveau « out »).
* ROUTE-013 : une MÉTÉO D'AVANT (`weather` = weatherFreshness()) plafonne la
* confiance — moyenne jusqu'à 12 h, faible au-delà — raison `stale-weather`
* en tête.
* → { level, reasons: [{ code, level: 'ok'|'mid'|'bad'|'out', …chiffres }] }
*/
function unifiedConfidence({ counts, spreadH, lateralNm, routedN, blocked = [], short = [], firstFarMs = null, weather = null }) {
	const reasons = [];
	const known = counts.accord + counts.partiel + counts["désaccord"];
	let along = "faible";
	if (known) {
		const okShare = counts.accord / known;
		along = counts["désaccord"] / known > .2 || okShare < .4 ? "faible" : okShare >= .7 && !counts["désaccord"] ? "élevée" : "moyenne";
	}
	reasons.push({
		code: "agree",
		level: along === "élevée" ? "ok" : along === "moyenne" ? "mid" : "bad",
		ok: counts.accord,
		partial: counts.partiel,
		disagree: counts["désaccord"]
	});
	let routes = "élevée";
	if (routedN < 2) routes = "faible";
	if (blocked.length) {
		routes = worst(routes, "moyenne");
		reasons.push({
			code: "blocked",
			level: "bad",
			models: blocked
		});
	}
	const sLevel = spreadH > 18 ? "faible" : spreadH > 6 ? "moyenne" : "élevée";
	const lLevel = lateralNm > 150 ? "faible" : lateralNm > 60 ? "moyenne" : "élevée";
	routes = worst(routes, sLevel, lLevel);
	if (routedN >= 2) {
		reasons.push({
			code: "spread",
			level: sLevel === "élevée" ? "ok" : sLevel === "moyenne" ? "mid" : "bad",
			hours: Math.round(spreadH * 10) / 10
		});
		reasons.push({
			code: "lateral",
			level: lLevel === "élevée" ? "ok" : lLevel === "moyenne" ? "mid" : "bad",
			nm: Math.round(lateralNm)
		});
	} else reasons.push({
		code: "single",
		level: "bad",
		routed: routedN
	});
	if (short.length) reasons.push({
		code: "short",
		level: "out",
		models: short
	});
	if (firstFarMs) reasons.push({
		code: "far",
		level: "out",
		fromMs: firstFarMs
	});
	const st = staleReason(weather);
	if (st) reasons.unshift(st);
	return {
		level: worst(along, routes, ...st ? [st.level === "mid" ? "moyenne" : "faible"] : []),
		along,
		routes,
		...st ? { weather: st.level === "mid" ? "moyenne" : "faible" } : {},
		reasons
	};
}
/** La raison `stale-weather` d'une météo d'avant (ou null). */
function staleReason(weather) {
	if (!weather?.stale) return null;
	return {
		code: "stale-weather",
		level: staleLevel(weather.oldestAgeH),
		ageH: weather.oldestAgeH,
		fetchedAt: weather.fetchedAt,
		models: weather.staleModels || [],
		waves: Boolean(weather.wavesStale)
	};
}
/**
* Ce qui demande une action (« À surveiller », ROUTAGE_UX §5 B) — pur :
* la nuit à l'arrivée, le moteur, les limites de B&C — et (ROUTE-011, les
* réponses de B&C) la marge de 80 %, le gazole, les dangers, ce qui a été
* relâché. Des CODES, traduits dans l'app.
*  · `day` : l'arrivée de jour est une priorité (Prudent) → la nuit à
*    l'arrivée est « à surveiller » (mid) ; sinon une simple information (ok) ;
*  · `fuel` / `fuelWorst` : fuelPlan() (prefs.mjs) — la réserve entamée est
*    CRITIQUE sur la route de référence, « à surveiller » si un modèle seulement ;
*  · `hazards` : hazardsAlong() — dedans : mid ; frôlé (≤ 30 milles) : ok.
*/
function watchList({ light, nightShare, motorH, flagged, limits, marginRows = [], margin = null, day = true, fuel = null, fuelWorst = null, hazards = [], relaxed = [], avoidLifted = [], weather = null }) {
	const w = [];
	if (weather?.stale) w.push({
		code: "staleWeather",
		level: staleLevel(weather.oldestAgeH),
		ageH: weather.oldestAgeH,
		fetchedAt: weather.fetchedAt,
		models: weather.staleModels || [],
		waves: Boolean(weather.wavesStale)
	});
	for (const r of relaxed) if (r.criterion === "limits") w.push({
		code: "relaxedMargin",
		level: "mid",
		asked: Math.round(r.asked * 100),
		best: Math.round(r.best * 100)
	});
	for (const x of avoidLifted) w.push({
		code: "hazardLifted",
		level: "mid",
		id: x.id,
		why: x.why
	});
	if (light && !light.day) w.push({
		code: "night",
		level: day ? "mid" : "ok",
		waitH: Math.round(light.waitH * 10) / 10,
		share: nightShare,
		day
	});
	else if (nightShare > .25) w.push({
		code: "nightSome",
		level: day ? "mid" : "ok",
		share: nightShare
	});
	if (fuel && (fuel.intoReserve || fuel.empty)) w.push({
		code: "fuelReserve",
		level: "bad",
		motorH: fuel.motorH,
		usedL: fuel.usedL,
		leftL: fuel.leftL,
		reserveL: fuel.reserveL,
		empty: fuel.empty
	});
	else if (fuelWorst && (fuelWorst.intoReserve || fuelWorst.empty)) w.push({
		code: "fuelReserveSome",
		level: "mid",
		model: fuelWorst.model,
		motorH: fuelWorst.motorH,
		usedL: fuelWorst.usedL,
		leftL: fuelWorst.leftL,
		reserveL: fuelWorst.reserveL
	});
	if (motorH && motorH.max >= 24) w.push({
		code: "motor",
		level: "mid",
		minH: Math.round(motorH.min),
		maxH: Math.round(motorH.max),
		...fuel ? { lph: fuel.lph } : {}
	});
	for (const h of hazards) w.push({
		code: "hazard",
		level: h.inside ? "mid" : "ok",
		id: h.id,
		inside: h.inside,
		closestNm: h.closestNm,
		atMs: h.enterMs ?? h.atMs,
		exitMs: h.exitMs,
		insideH: h.insideH,
		side: h.side,
		inSeason: h.inSeason,
		avoid: h.avoid
	});
	if (flagged.length) w.push({
		code: "limits",
		level: "bad",
		count: flagged.length,
		firstMs: flagged[0].t,
		flags: flagged[0].flags
	});
	else if (margin && marginRows.length) w.push({
		code: "margin",
		level: "mid",
		pct: margin.pct,
		count: marginRows.length,
		firstMs: marginRows[0].t,
		flags: marginRows[0].marginFlags,
		maxTws: margin.maxTws,
		maxGust: margin.maxGust,
		maxWave: margin.maxWave
	});
	else if (margin) w.push({
		code: "withinMargin",
		level: "ok",
		pct: margin.pct,
		maxTws: margin.maxTws,
		maxGust: margin.maxGust,
		maxWave: margin.maxWave
	});
	else w.push({
		code: "within",
		level: "ok",
		maxTws: limits.maxTws,
		maxGust: limits.maxGust,
		maxWave: limits.maxWave
	});
	if (fuel && !fuel.intoReserve && !fuel.empty) w.push({
		code: "fuel",
		level: "ok",
		motorH: fuel.motorH,
		usedL: fuel.usedL,
		leftL: fuel.leftL,
		leftPct: fuel.leftPct,
		leftRangeH: fuel.leftRangeH,
		leftRangeNm: fuel.leftRangeNm
	});
	return w;
}
/**
* L'ordre des essais quand aucun modèle ne passe (pur) : la marge relâchée de
* 10 points à la fois jusqu'aux limites de B&C (jamais au-delà, D5), puis les
* dangers évités levés. → [{ scale, avoid }]
*/
function relaxSteps(askedScale, hasAvoid) {
	const out = [];
	let s = Math.min(1, askedScale);
	for (;;) {
		out.push({
			scale: s,
			avoid: hasAvoid
		});
		if (s >= 1) break;
		s = Math.min(1, Math.round((s + .1) * 100) / 100);
	}
	if (hasAvoid) out.push({
		scale: 1,
		avoid: false
	});
	return out;
}
/** Le conseil. */
async function computeAdvice(request, { cacheDir, threads = Math.max(1, os.availableParallelism() - 1), log = () => {}, onStep = () => {}, polar = null, nowMs = Date.now(), astarBudgetMs = 15e4, engineUsage = null, departBudgetMs = BEST_DEPARTURE_BUDGET_MS, shouldStop = null, onWeather = null, io = null } = {}) {
	const t0 = Date.now();
	const IO = {
		loadCharts,
		fetchWindGrid,
		fetchWaveGrid,
		fetchEnsembleGrids,
		previousGrid,
		previousEnsembleGrids,
		createPool,
		resolvePlace,
		timezoneAt,
		...io || {}
	};
	const modelMeta = (m) => MODELS[m] || IO.modelInfo?.(m) || {
		label: m,
		kind: "physique"
	};
	const crewKeys = Object.keys(CREW_DEFAULTS);
	const prefs0 = prefsOf({
		...DEFAULT_LIMITS,
		...request.limits || {}
	});
	const limits = {
		...DEFAULT_LIMITS,
		...Object.fromEntries(crewKeys.map((k) => [k, prefs0[k]])),
		...request.limits || {}
	};
	for (const k of crewKeys) limits[k] = prefs0[k];
	const step = (name, extra = {}) => onStep({
		name,
		index: STEPS.indexOf(name),
		of: STEPS.length,
		...extra
	});
	const POLAR0 = polar || loadPolar();
	const PU = polarForRoute(POLAR0, prefs0);
	const POLAR = {
		...POLAR0,
		mixed: {
			...POLAR0.mixed,
			table: PU.table
		}
	};
	step("places");
	const place = async (v) => typeof v === "object" && v && Number.isFinite(v.lat) ? {
		lat: v.lat,
		lon: v.lon,
		name: v.name || `${v.lat.toFixed(2)}, ${v.lon.toFixed(2)}`,
		kind: v.kind || "point"
	} : IO.resolvePlace(v);
	const from0 = await place(request.from ?? "bateau");
	const to0 = await place(request.to);
	const BBOX = passageBbox(from0, to0);
	step("charts");
	const CH = await IO.loadCharts(BBOX, {
		cacheDir,
		dilateMask,
		coastNm: limits.coastNm,
		...Number.isFinite(limits.minDepth) ? { minDepth: limits.minDepth } : {},
		log
	});
	const sea = (p) => {
		const q = snapToSea(CH.land, p);
		if (!q) {
			const e = /* @__PURE__ */ new Error(`${p.name} : pas de mer à moins de 15 milles`);
			e.code = "no-sea";
			throw e;
		}
		return {
			...p,
			lat: q.lat,
			lon: q.lon,
			movedNm: Math.round(q.movedNm * 10) / 10,
			asked: {
				lat: p.lat,
				lon: p.lon
			},
			strait: straitOf(p)
		};
	};
	const from = sea(from0);
	const to = sea(to0);
	const gates = gatesBetween(from, to).map((g) => {
		const q = snapToSea(CH.land, g);
		return {
			lat: q.lat,
			lon: q.lon,
			name: g.name,
			strait: g.strait
		};
	});
	step("weather");
	const wx = await loadWeather(request.weatherSource, {
		bbox: BBOX,
		nowMs,
		cacheDir,
		log,
		isLand: CH.land.isLand,
		models: Array.isArray(IO.models) && IO.models.length ? IO.models.slice() : Object.keys(MODELS),
		onModel: (done, total) => step("weather", {
			done,
			total
		}),
		io: {
			fetchWindGrid: IO.fetchWindGrid,
			fetchWaveGrid: IO.fetchWaveGrid,
			fetchEnsembleGrids: IO.fetchEnsembleGrids,
			previousGrid: IO.previousGrid,
			previousEnsembleGrids: IO.previousEnsembleGrids
		}
	});
	onWeather?.(wx);
	const { grids, waves, models } = wx;
	const weather = {
		...weatherFreshness(grids, waves),
		...weatherSourceInfo(wx)
	};
	if (weather.stale) log(`⚠ météo d'avant (${weather.oldestAgeH} h) : ${[...weather.staleModels, ...weather.wavesStale ? ["vagues"] : []].join(", ")}`);
	const departMs = request.departMs ?? nextHour(nowMs);
	step("reference");
	const stops = [
		from,
		...gates,
		to
	];
	const prefs = withEngineUsage(prefsOf(limits), engineUsage);
	const askedScale = rapideScale(prefs);
	const zones = hazardZones(prefs);
	const avoid = avoidRings(zones, stops);
	const relaxed = [];
	const runModels = async (L, forbiddenAll) => {
		const pool = IO.createPool(new URL("./routeWorker.mjs", import.meta.url), {
			polar: POLAR.mixed.table,
			grids,
			waves,
			land: CH.land.data,
			coast: CH.coast.data,
			forbidden: forbiddenAll,
			forbiddenMask: CH.forbiddenMask.data,
			coastIndex: CH.coastIndex.data,
			limits: L
		}, Math.max(1, Math.min(models.length, threads)));
		try {
			let n = 0;
			const out = await Promise.all(models.map((m) => pool.run({
				model: m,
				stops,
				departMs
			}).then((r) => {
				step("models", {
					done: ++n,
					total: models.length
				});
				return r;
			})));
			return Object.fromEntries(models.map((m, i) => [m, out[i]]));
		} finally {
			await pool.close();
		}
	};
	const astarKeys = (request.options || {}).optimiser === false ? [] : profilesToRun(prefs);
	const astarModel = grids.ecmwf_ifs025 ? "ecmwf_ifs025" : models[0];
	const astarT0 = Date.now();
	let astarDone = 0;
	const voileSlow = voileSlowPctOf(prefs);
	const lateKeys = voileSlow != null ? astarKeys.filter((k) => k === "voile") : [];
	const earlyKeys = astarKeys.filter((k) => !lateKeys.includes(k));
	const astarCtx = {
		polar: POLAR.mixed.table,
		grid: grids[astarModel],
		model: astarModel,
		waves,
		land: CH.land,
		coast: CH.coast,
		forbidden: [...CH.forbidden, ...avoid.rings],
		forbiddenMask: CH.forbiddenMask,
		coastIndex: CH.coastIndex,
		bbox: BBOX,
		limits,
		stops,
		departMs,
		prefs,
		threads: Math.max(1, Math.min(earlyKeys.length, Math.ceil(threads / 2))),
		deadlineMs: astarT0 + astarBudgetMs,
		onDone: () => {
			astarDone += 1;
		},
		createPool: IO.createPool
	};
	const astar = runOptimiser(astarCtx, earlyKeys);
	const allBlocked = (X) => !models.some((m) => X[m].ok) && models.some((m) => !X[m].ok && !X[m].short);
	let scale;
	let avoidNow;
	let routeLimits;
	let R;
	for (const st of relaxSteps(askedScale, avoid.rings.length > 0)) {
		scale = st.scale;
		avoidNow = st.avoid ? avoid.rings : [];
		routeLimits = scaleLimits(limits, scale);
		R = await runModels(routeLimits, [...CH.forbidden, ...avoidNow]);
		if (!allBlocked(R)) break;
	}
	if (scale !== askedScale) relaxed.push({
		criterion: "limits",
		asked: askedScale,
		best: scale
	});
	const avoidLifted = [...avoid.lifted.map((id) => ({
		id,
		why: "stop"
	}))];
	if (avoid.rings.length && !avoidNow.length) {
		for (const z of zones) if (z.avoid && !avoid.lifted.includes(z.id)) avoidLifted.push({
			id: z.id,
			why: "blocked"
		});
	}
	const avoided = zones.filter((z) => z.avoid && !avoidLifted.some((x) => x.id === z.id)).map((z) => z.id);
	const ok = models.filter((m) => R[m].ok);
	const refModel = ok.includes("ecmwf_ifs025") ? "ecmwf_ifs025" : ok[0] || null;
	const short = models.filter((m) => !R[m].ok && R[m].short);
	const blocked = models.filter((m) => !R[m].ok && !R[m].short);
	const astarLate = lateKeys.length && refModel ? runOptimiser({
		...astarCtx,
		threads: 1,
		slowCap: {
			pct: voileSlow,
			refHours: R[refModel].hours
		}
	}, lateKeys) : null;
	const tz = await IO.timezoneAt(to.lat, to.lon, {
		cacheDir,
		offline: wx.offline
	});
	const base = {
		v: 1,
		computedAt: new Date(nowMs).toISOString(),
		request: {
			...request,
			departMs
		},
		from,
		to: {
			...to,
			tz
		},
		via: gates.map((g) => g.name),
		gates: gates.map((g) => ({
			lat: Math.round(g.lat * 1e4) / 1e4,
			lon: Math.round(g.lon * 1e4) / 1e4,
			name: g.name
		})),
		departMs,
		limits,
		prefs: {
			profile: prefs.profile,
			order: prefs.order,
			marginPct: prefs.marginPct,
			motorCapPct: prefs.motorCapPct,
			routesShown: prefs.routesShown,
			engineMode: prefs.engineMode,
			rapideMargin: prefs.rapideMargin,
			rapideMarginPct: prefs.rapideMarginPct,
			weights: prefs.weights
		},
		margin: {
			asked: askedScale,
			used: scale,
			limits: {
				maxTws: routeLimits.maxTws,
				maxGust: routeLimits.maxGust,
				maxWave: routeLimits.maxWave
			}
		},
		relaxed,
		avoided,
		avoidLifted,
		charts: CH.sources,
		forbidden: CH.forbidden.map((r) => r.map(([lo, la]) => [Math.round(lo * 1e4) / 1e4, Math.round(la * 1e4) / 1e4])),
		polar: {
			builtAt: POLAR.polarVersion?.builtAt || POLAR.builtAt,
			rows: POLAR.rows,
			learnedCells: POLAR.mixed.learnedCells,
			sailConfigs: Object.keys(POLAR.bySail || {}).length,
			calibration: polarCalibration(POLAR),
			...polarVersionBlock(POLAR)
		},
		forecast: {
			fetchedAt: grids[models[0]].fetchedAt,
			models: Object.fromEntries(models.map((m) => [m, {
				label: modelMeta(m).label,
				kind: modelMeta(m).kind,
				hours: grids[m].times.length,
				fetchedAt: grids[m].fetchedAt || null,
				...weather.models[m]?.stale ? {
					stale: true,
					ageH: weather.models[m].ageH
				} : {}
			}]))
		},
		weather
	};
	if (!refModel) {
		await astar.close();
		const st = staleReason(weather);
		return applyWeatherSource({
			...base,
			ok: false,
			reason: blocked.length ? "blocked" : "short",
			models: Object.fromEntries(models.map((m) => [m, {
				ok: false,
				short: Boolean(R[m].short),
				reason: R[m].reason
			}])),
			confidence: {
				level: "faible",
				reasons: [...st ? [st] : [], {
					code: blocked.length ? "blocked" : "short",
					level: blocked.length ? "bad" : "out",
					models: blocked.length ? blocked : short
				}]
			},
			ms: Date.now() - t0
		});
	}
	step("along");
	const ref = R[refModel];
	const route = ref.points.map((p) => ({
		t: p.t,
		lat: Math.round(p.lat * 1e4) / 1e4,
		lon: Math.round(p.lon * 1e4) / 1e4,
		heading: p.heading,
		speed: p.speed != null ? Math.round(p.speed * 10) / 10 : null,
		mode: p.mode,
		tws: p.tws != null ? Math.round(p.tws * 10) / 10 : null,
		twd: p.twd != null ? Math.round(p.twd) : null,
		twa: p.twa != null ? Math.round(p.twa) : null,
		wave: p.wave != null ? Math.round(p.wave * 10) / 10 : null
	}));
	const everyH = 3;
	const alongRows = (points, tEnd, counts = null, tStart = departMs) => {
		const timed = points.map((p) => ({
			lat: p.lat,
			lon: p.lon,
			t: p.t
		}));
		const times = [];
		for (let t = tStart; t < tEnd; t += everyH * 36e5) times.push(t);
		times.push(tEnd);
		const out = [];
		for (const t of times) {
			const p = positionAt(timed, t) || {
				...timed[timed.length - 1],
				course: out.at(-1)?.course ?? 0
			};
			const winds = models.map((m) => windAt(grids[m], p.lat, p.lon, t));
			const wave = waveAt(waves, p.lat, p.lon, t);
			const ag = agreement(winds);
			if (counts) counts[ag.level]++;
			const fl = flags({
				winds,
				wave,
				course: p.course
			}, limits);
			const mfl = scale < 1 && !fl.length ? flags({
				winds,
				wave,
				course: p.course
			}, {
				...limits,
				...routeLimits
			}).filter((f) => !f.startsWith("près")) : [];
			out.push({
				t,
				lat: Math.round(p.lat * 1e3) / 1e3,
				lon: Math.round(p.lon * 1e3) / 1e3,
				course: Math.round(p.course ?? 0),
				night: isNight(p.lat, p.lon, t),
				winds: winds.map((w) => w ? {
					tws: Math.round(w.tws * 10) / 10,
					twd: Math.round(w.twd),
					gust: w.gust != null ? Math.round(w.gust) : null
				} : null),
				wave: wave != null ? Math.round(wave * 10) / 10 : null,
				ag: {
					level: ag.level,
					twsSpread: Math.round(ag.twsSpread * 10) / 10,
					twdSpread: Math.round(ag.twdSpread)
				},
				flags: fl,
				...mfl.length ? { marginFlags: mfl } : {}
			});
		}
		return out;
	};
	const counts = {
		accord: 0,
		partiel: 0,
		"désaccord": 0,
		inconnu: 0
	};
	const rows = alongRows(ref.points, ref.arrivalMs, counts);
	step("checks");
	let lateral = 0;
	if (ok.length > 1) {
		const tFirst = Math.min(...ok.map((m) => R[m].arrivalMs));
		for (let t = departMs; t <= tFirst; t += 3 * 36e5) for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) lateral = Math.max(lateral, distNm(at(R[ok[i]].points, t), at(R[ok[j]].points, t)));
	}
	const etas = ok.map((m) => R[m].arrivalMs).sort((a, b) => a - b);
	const medianEta = etas[Math.floor((etas.length - 1) / 2)];
	const spreadH = etas.length > 1 ? (etas.at(-1) - etas[0]) / 36e5 : 0;
	const firstFar = rows.find((r) => r.t - nowMs > 7 * 864e5);
	const confidence = unifiedConfidence({
		counts,
		spreadH,
		lateralNm: lateral,
		routedN: ok.length,
		blocked,
		short,
		firstFarMs: firstFar?.t ?? null,
		weather
	});
	if (scale < 1) {
		for (const r of confidence.reasons) if (r.code === "blocked") r.marginPct = Math.round(scale * 100);
	}
	const light = arrivalLight(to.lat, to.lon, medianEta);
	const nightShare = ok.length ? ok.filter((m) => !arrivalLight(to.lat, to.lon, R[m].arrivalMs).day).length / ok.length : 0;
	const motors = ok.map((m) => R[m].stats.motorH);
	const flagged = rows.filter((r) => r.flags.length);
	const fuel = fuelPlan(ref.stats.motorH, prefs, routeLimits.motorKn);
	const worstM = ok.reduce((w, m) => R[m].stats.motorH > (w ? R[w].stats.motorH : -1) ? m : w, null);
	const fuelWorst = worstM ? {
		model: worstM,
		motorH: Math.round(R[worstM].stats.motorH * 10) / 10,
		...fuelPlan(R[worstM].stats.motorH, prefs, routeLimits.motorKn)
	} : null;
	const hazards = hazardsAlong(ref.points, zones);
	const bilanFor = (points, waitH = 0) => bilanOf(points, {
		L: limits,
		to,
		isNight,
		arrivalLight,
		waitH,
		fuelLph: fuel.lph,
		fuelAboardL: fuel.aboardL,
		fuelReserveL: fuel.reserveL,
		zones
	});
	const watch = watchList({
		light,
		nightShare: Math.round(nightShare * 100) / 100,
		motorH: motors.length ? {
			min: Math.min(...motors),
			max: Math.max(...motors)
		} : null,
		flagged,
		limits,
		marginRows: rows.filter((r) => r.marginFlags),
		margin: scale < 1 ? {
			pct: Math.round(scale * 100),
			...base.margin.limits
		} : null,
		day: wantsDay(prefs),
		fuel: {
			...fuel,
			motorH: Math.round(ref.stats.motorH * 10) / 10
		},
		fuelWorst,
		hazards,
		relaxed,
		avoidLifted,
		weather
	});
	const fatigue = fatigueAlong(ref.points, limits, {
		isNight,
		arrivalDay: Boolean(light.day)
	});
	watch.push(...fatigueWatch(fatigue, limits));
	const cells = polarCellsAlong(ref.points, POLAR0);
	const pReason = polarReason(cells, PU.mode);
	if (pReason) confidence.reasons.push(pReason);
	if (cells.known && cells.escaleShare > .25 && cells.spans.length) watch.push({
		code: "polarLowConf",
		level: "ok",
		share: cells.escaleShare,
		escaleH: cells.escaleH,
		fromMs: cells.spans[0].fromMs,
		toMs: cells.spans[0].toMs,
		mode: PU.mode
	});
	const thin = (pts) => pts.map((p) => [
		Math.round(p.lon * 1e4) / 1e4,
		Math.round(p.lat * 1e4) / 1e4,
		p.t
	]);
	const round1 = (x) => x == null ? null : Math.round(x * 10) / 10;
	const result = {
		...base,
		ok: true,
		refModel,
		arrival: {
			medianMs: medianEta,
			minMs: etas[0],
			maxMs: etas.at(-1),
			models: ok.length,
			light: {
				day: light.day,
				waitH: round1(light.waitH),
				rise: light.rise ?? null,
				set: light.set ?? null
			},
			nightShare: Math.round(nightShare * 100) / 100
		},
		reference: {
			arrivalMs: ref.arrivalMs,
			hours: round1(ref.hours),
			distanceNm: Math.round(ref.distanceNm),
			stats: Object.fromEntries(Object.entries(ref.stats).map(([k, v]) => [k, round1(v)]))
		},
		models: Object.fromEntries(models.map((m) => [m, {
			...R[m].ok ? {
				ok: true,
				arrivalMs: R[m].arrivalMs,
				hours: round1(R[m].hours),
				distanceNm: Math.round(R[m].distanceNm),
				stats: Object.fromEntries(Object.entries(R[m].stats).map(([k, v]) => [k, round1(v)])),
				light: arrivalLight(to.lat, to.lon, R[m].arrivalMs).day,
				line: thin(R[m].points),
				bilan: bilanFor(R[m].points)
			} : {
				ok: false,
				short: Boolean(R[m].short),
				reason: R[m].reason
			},
			weather: routeWeather(weather, m)
		}])),
		route,
		rows,
		rowModels: models,
		everyH,
		agreementCounts: counts,
		spreadH: round1(spreadH),
		lateralNm: Math.round(lateral),
		firstFarMs: firstFar?.t ?? null,
		confidence,
		watch,
		fatigue: {
			...fatigue,
			runs: fatigue.runs.slice(0, 3)
		},
		polarUncertainty: {
			...uncertaintyOf(prefs),
			factor: PU.factor,
			cellsKnown: PU.cellsKnown,
			cells
		},
		fuel: {
			...fuel,
			motorH: Math.round(ref.stats.motorH * 10) / 10,
			worst: fuelWorst,
			tankL: prefs.fuelTankL,
			pct: prefs.fuelPct,
			reservePct: prefs.fuelReservePct,
			rpm: prefs.fuelRpm,
			engine: prefs.engine
		},
		hazards,
		hazardZones: zones.filter((z) => hazards.some((h) => h.id === z.id)).map((z) => ({
			id: z.id,
			kind: z.kind,
			ring: ringForMap(z.ring),
			avoid: avoided.includes(z.id)
		}))
	};
	let astarRaw = {};
	const fatOf = (points, day, waitH = 0) => {
		const f = fatigueAlong(points, limits, {
			isNight,
			arrivalDay: day,
			waitH
		});
		return {
			overH: f.overH,
			maxRunH: f.maxRunH,
			lastHardH: f.lastHardH,
			nights: f.nights,
			decayPct: f.decayPct,
			score: f.score,
			top: f.runs[0] || null
		};
	};
	if (astarKeys.length) {
		step("optimiser", {
			done: astarDone,
			total: astarKeys.length
		});
		const raw = {
			...await astar.done,
			...astarLate ? await astarLate.done : {}
		};
		astarRaw = raw;
		step("optimiser", {
			done: astarKeys.length,
			total: astarKeys.length
		});
		const common = {
			to,
			stops,
			coastIndex: CH.coastIndex,
			zones,
			prefs,
			motorKn: limits.motorKn ?? 6
		};
		const rapide = summarizeRoute(ref.points, {
			...common,
			key: "rapide",
			source: "isochrones",
			model: refModel,
			extra: {
				line: thin(ref.points),
				weather: routeWeather(weather, refModel)
			}
		});
		const profiles = { rapide: {
			...rapide,
			why: [],
			fatigue: fatOf(ref.points, rapide.day)
		} };
		const astarWx = routeWeather(weather, astarModel);
		for (const k of astarKeys) {
			const r = raw[k];
			if (!r?.ok) {
				profiles[k] = {
					ok: false,
					key: k,
					source: "astar",
					model: astarModel,
					reason: r?.reason === "time" ? "time" : r?.short ? "short" : r?.reason === "error" ? "error" : "blocked",
					relaxed: r?.relaxed || [],
					order: orderFor(k, prefs),
					weather: astarWx
				};
				profiles[k].why = profileWhy(profiles[k], rapide);
				continue;
			}
			const sm = summarizeRoute(r.points, {
				...common,
				key: k,
				source: "astar",
				model: astarModel,
				waitH: r.waitH || 0,
				extra: {
					line: thin(r.points),
					order: r.order,
					relaxed: r.relaxed || [],
					search: {
						ms: r.search?.ms ?? null,
						labels: r.search?.labels ?? null
					},
					weather: astarWx,
					...r.slowCap ? { slowCap: r.slowCap } : {}
				}
			});
			sm.rows = alongRows(r.points, r.points.at(-1).t);
			sm.modes = modeSpans(r.points);
			const lat = lateralNm(ref.points, r.points);
			sm.sameAs = Math.abs(sm.hours - rapide.hours) < .5 && lat != null && lat < 3 ? "rapide" : null;
			sm.why = profileWhy(sm, rapide);
			sm.fatigue = fatOf(r.points, sm.day, r.waitH || 0);
			profiles[k] = sm;
		}
		result.profiles = profiles;
		result.profileOrder = ["rapide", ...astarKeys];
		result.optimiser = {
			model: astarModel,
			ms: Date.now() - astarT0,
			budgetS: Math.round(astarBudgetMs / 1e3),
			chosen: prefs.profile,
			weather: astarWx
		};
	}
	const opt = request.options || {};
	if (opt.polar || opt.departures || opt.ensembles || opt.bestDeparture || opt.crew) {
		const ctx = {
			from,
			to,
			stops,
			bbox: BBOX,
			grids,
			waves,
			land: CH.land,
			coast: CH.coast,
			forbidden: [...CH.forbidden, ...avoidNow],
			forbiddenMask: CH.forbiddenMask,
			coastIndex: CH.coastIndex,
			polar: POLAR.mixed.table,
			limits: routeLimits,
			departMs,
			refModel,
			threads,
			cacheDir,
			log,
			fetchEnsemble: wx.offline ? wx.ensemble : null,
			bilan: bilanFor,
			createPool: IO.createPool
		};
		const errs = {};
		const tryOpt = async (key, fn) => {
			try {
				await fn();
			} catch (e) {
				if (e?.constructor?.name === "Cancelled") throw e;
				const msg = String(e?.message || e || "erreur").slice(0, 300);
				errs[key] = typeof e?.code === "string" && /^[A-Za-z][\w-]{1,30}$/.test(e.code) && !msg.startsWith(`[${e.code}]`) ? `[${e.code}] ${msg}` : msg;
				log(`option ${key} : ${errs[key]}`);
			}
		};
		if (opt.polar) await tryOpt("polar", async () => {
			result.sensitivity = await polarSensitivity(ctx, {
				base: ref,
				factors: PU.sensitivity,
				onStep: step2
			});
		});
		if (opt.departures) await tryOpt("departures", async () => {
			result.departures = await departurePlan(ctx, { onStep: step2 });
		});
		if (opt.crew) await tryOpt("crew", async () => {
			result.crewSensitivity = await crewSensitivity(ctx, {
				base: ref,
				onStep: step2
			});
		});
		if (opt.ensembles) await tryOpt("ensembles", async () => {
			const ens = await ensembleRun(ctx, { onStep: step2 });
			result.ensemble = ens;
			result.confidence = withEnsembleConfidence(result.confidence, ens);
		});
		if (opt.bestDeparture) await tryOpt("bestDeparture", async () => {
			const askedH = Number(opt.bestDeparture?.windowH) || 48;
			const sameRapide = scale === askedScale && refModel === astarModel && avoidNow.length === avoid.rings.length;
			const others = Object.fromEntries(models.filter((m) => m !== astarModel).map((m) => [m, R[m]]));
			result.bestDeparture = await bestDeparture({
				stops,
				to,
				bbox: BBOX,
				grids,
				waves,
				land: CH.land,
				coast: CH.coast,
				forbidden: [...CH.forbidden, ...avoidNow],
				forbiddenMask: CH.forbiddenMask,
				coastIndex: CH.coastIndex,
				polar: POLAR.mixed.table,
				limits,
				rapideLimits: scaleLimits(limits, askedScale),
				prefs,
				astarModel,
				threads,
				alongRows,
				isNight,
				arrivalLight,
				zones,
				modeSpans,
				createPool: IO.createPool,
				avoid: avoidNow,
				departMs,
				orderFor,
				wantsDay: wantsDay(prefs),
				marginScale: marginScale(prefs),
				fuel: {
					lph: fuel.lph,
					aboardL: fuel.aboardL,
					reserveL: fuel.reserveL
				},
				reuse: {
					rapide: sameRapide ? ref : null,
					astar: astarRaw,
					astarOrders: Object.fromEntries(astarKeys.map((k) => [k, orderFor(k, prefs)])),
					models: sameRapide ? others : null
				}
			}, {
				windowH: askedH,
				budgetMs: departBudgetMs,
				onStep: step2,
				shouldStop,
				passageH: ref.hours,
				rows: Array.isArray(opt.bestDeparture?.rows) ? opt.bestDeparture.rows.filter((r) => typeof r === "string").slice(0, 6) : null
			});
		});
		if (Object.keys(errs).length) result.optionErrors = errs;
	}
	result.options = {
		polar: Boolean(opt.polar),
		departures: Boolean(opt.departures),
		ensembles: Boolean(opt.ensembles),
		bestDeparture: Boolean(opt.bestDeparture),
		crew: Boolean(opt.crew),
		...request.optionsStripped?.length ? { stripped: request.optionsStripped } : {}
	};
	try {
		const clearFor = (rings) => (a, b) => makeClear({
			start: stops[a],
			dest: stops[b],
			L: limits,
			land: CH.land,
			coast: CH.coast,
			forbidden: [...CH.forbidden, ...rings],
			forbiddenMask: CH.forbiddenMask,
			coastIndex: CH.coastIndex,
			zoneStepNm: .05
		});
		const guardFor = (rings) => {
			const z = exactZones([...CH.forbidden, ...rings]);
			return () => (p, q) => !CH.coastIndex.crosses(p, q) && !(z && z.blocks(p, q));
		};
		for (const [k, p] of Object.entries(result.profiles || {})) {
			const rings = k === "rapide" ? avoidNow : avoid.rings;
			if (p?.ok && Array.isArray(p.line) && p.line.length > 1) p.reach = legReach(p.line, {
				stops,
				clearFor: clearFor(rings),
				guardFor: guardFor(rings)
			});
		}
		if (!result.profiles?.rapide?.reach && Array.isArray(result.route)) result.routeReach = legReach(result.route, {
			stops,
			clearFor: clearFor(avoidNow),
			guardFor: guardFor(avoidNow)
		});
	} catch (e) {
		log(`feuille de route (reach) : ${e?.message || e}`);
	}
	applyWeatherSource(result);
	assertLinesAtSea(result, CH.coastIndex, CH.forbidden, avoidNow);
	result.ms = Date.now() - t0;
	return result;
	function step2(sx) {
		onStep({
			...sx,
			index: STEPS.indexOf(sx.name),
			of: STEPS.length
		});
	}
}
/**
* Toutes les lignes d'un résultat, telles que l'app les dessine : la route de
* référence, celle de chaque modèle, le membre médian de l'ensemble.
*/
function linesOf(result) {
	const pts = (l) => (l || []).map((p) => Array.isArray(p) ? {
		lon: p[0],
		lat: p[1]
	} : {
		lon: p.lon,
		lat: p.lat
	});
	const out = { route: pts(result.route) };
	for (const [m, v] of Object.entries(result.models || {})) if (v.ok && v.line) out[`model:${m}`] = pts(v.line);
	if (result.ensemble?.median?.line) out["ensemble-median"] = pts(result.ensemble.median.line);
	for (const [k, v] of Object.entries(result.profiles || {})) if (v?.ok && v.line) out[`profile:${k}`] = pts(v.line);
	for (const [k, v] of Object.entries(departureLines(result.bestDeparture))) out[k] = pts(v);
	return out;
}
/**
* Lève une erreur si une ligne du résultat croise la côte exacte, entre dans
* une zone interdite (les anneaux exacts : code 'tss'), ou dans un danger
* ÉVITÉ (`avoid`, les anneaux des Réglages : code 'hazard').
*/
function assertLinesAtSea(result, coastIndex, forbidden = null, avoid = null) {
	if (!result?.ok) return;
	const zones = exactZones(forbidden);
	const hz = avoid && avoid.length ? exactZones(avoid) : null;
	for (const [k, line] of Object.entries(linesOf(result))) {
		const i = coastIndex ? coastIndex.firstCrossing(line) : -1;
		if (i >= 0) {
			const e = /* @__PURE__ */ new Error(`ligne ${k} sur la terre entre ${line[i - 1].lat.toFixed(3)}, ${line[i - 1].lon.toFixed(3)} et ${line[i].lat.toFixed(3)}, ${line[i].lon.toFixed(3)} — calcul refusé`);
			e.code = "land";
			throw e;
		}
		for (let j = 1; j < line.length; j++) {
			if (zones && zones.blocks(line[j - 1], line[j])) {
				const e = /* @__PURE__ */ new Error(`ligne ${k} dans un dispositif de séparation du trafic entre ${line[j - 1].lat.toFixed(3)}, ${line[j - 1].lon.toFixed(3)} et ${line[j].lat.toFixed(3)}, ${line[j].lon.toFixed(3)} — calcul refusé`);
				e.code = "tss";
				throw e;
			}
			if (hz && hz.blocks(line[j - 1], line[j])) {
				const e = /* @__PURE__ */ new Error(`ligne ${k} dans une zone de danger évitée entre ${line[j - 1].lat.toFixed(3)}, ${line[j - 1].lon.toFixed(3)} et ${line[j].lat.toFixed(3)}, ${line[j].lon.toFixed(3)} — calcul refusé`);
				e.code = "hazard";
				throw e;
			}
		}
	}
}
var EDGE_PAD = .05;
var ETOPO_STEP = .0125;
var SUB = 1 / 240;
/** La clé d'une tuile (son coin sud-ouest). */
var tileKey = (w, s) => `${w}_${s}`;
/** Les tuiles qu'il faut pour une emprise [O, S, E, N] (celles qui la touchent). */
function tilesFor(bbox) {
	const [w, s, e, n] = bbox;
	const out = [];
	for (let x = Math.floor(w / 5) * 5; x < e; x += 5) for (let y = Math.floor(s / 5) * 5; y < n; y += 5) out.push(tileKey(x, y));
	return out;
}
/**
* L'emprise est-elle couverte par les tuiles publiées ? → { ok, missing: [clé…] }.
* `index.tiles` : { clé: { empty?, bytes } } ; une tuile absente de l'index = pas de carte.
*/
function coverage(bbox, index) {
	const missing = tilesFor(bbox).filter((k) => !index?.tiles?.[k]);
	const ties = bbox.every((v) => Number.isInteger(v)) && [bbox[1], bbox[3]].every((v) => index?.ties?.lat?.[v] != null) && [bbox[0], bbox[2]].every((v) => index?.ties?.lon?.[v] != null);
	return {
		ok: !missing.length && ties,
		missing,
		ties
	};
}
/** Lit une tuile (octets déjà décompressés). */
function decodeTile(bytes) {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "WGT1") throw Object.assign(/* @__PURE__ */ new Error("tuile illisible"), { code: "charts-format" });
	const hl = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(4, true);
	const head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl)));
	const buf = u8.byteOffset % 8 === 0 ? u8 : u8.slice();
	const base = buf.byteOffset;
	const { cols, rows } = head.mask;
	const bits = buf.subarray(head.offs.mask, head.offs.mask + Math.ceil(cols * rows / 8));
	const grid = new Uint8Array(cols * rows);
	for (let i = 0; i < grid.length; i++) grid[i] = bits[i >> 3] >> (i & 7) & 1;
	const etopo = head.etopo ? {
		...head.etopo,
		cls: buf.subarray(head.offs.etopo, head.offs.etopo + head.etopo.rows * head.etopo.cols)
	} : null;
	const edges = new Float64Array(buf.buffer, base + head.offs.edges, head.edges * 4);
	return {
		head,
		tile: head.tile,
		cellDeg: head.cellDeg,
		mask: {
			grid,
			cols,
			rows
		},
		etopo,
		edges
	};
}
/** Le masque de terre de l'emprise : la mosaïque des tuiles (mêmes cellules, même balayage). */
function maskFromTiles(bbox, tiles, cellDeg = .01) {
	const [w, s, e, n] = bbox;
	const cols = Math.ceil((e - w) / cellDeg);
	const rows = Math.ceil((n - s) / cellDeg);
	const grid = new Uint8Array(cols * rows);
	for (let r = 0; r < rows; r++) {
		const lat = s + (r + .5) * cellDeg;
		const ty = Math.floor(lat / 5) * 5;
		for (let c = 0; c < cols; c++) {
			const lon = w + (c + .5) * cellDeg;
			const tx = Math.floor(lon / 5) * 5;
			const t = tiles.get(tileKey(tx, ty));
			if (!t) throw Object.assign(/* @__PURE__ */ new Error(`pas de carte hors ligne pour ${tx}°, ${ty}°`), { code: "no-charts" });
			const tr = Math.round((lat - ty) / cellDeg - .5);
			const tc = Math.round((lon - tx) / cellDeg - .5);
			if (tr < 0 || tc < 0 || tr >= t.mask.rows || tc >= t.mask.cols) continue;
			grid[r * cols + c] = t.mask.grid[tr * t.mask.cols + tc];
		}
	}
	return maskFromGrid({
		grid,
		cols,
		rows,
		bbox,
		cellDeg
	});
}
/** Les arêtes de côte de l'emprise ± 0,05° (sans doublon), dans l'ordre des tuiles. */
function edgesFromTiles(bbox, tiles) {
	const [w, s, e, n] = bbox;
	const pad = EDGE_PAD;
	const seen = /* @__PURE__ */ new Set();
	const xs = [];
	for (const k of tilesFor(bbox)) {
		const t = tiles.get(k);
		if (!t) throw Object.assign(/* @__PURE__ */ new Error(`pas de carte hors ligne (${k})`), { code: "no-charts" });
		const E = t.edges;
		for (let i = 0; i < E.length; i += 4) {
			const x1 = E[i];
			const y1 = E[i + 1];
			const x2 = E[i + 2];
			const y2 = E[i + 3];
			if (Math.max(x1, x2) < w - pad || Math.min(x1, x2) > e + pad || Math.max(y1, y2) < s - pad || Math.min(y1, y2) > n + pad) continue;
			const key = `${x1},${y1},${x2},${y2}`;
			if (seen.has(key)) continue;
			seen.add(key);
			xs.push(x1, y1, x2, y2);
		}
	}
	return xs;
}
/**
* Les petits fonds (< `minDepth` m) sur la grille du masque — EXACTEMENT ceux
* de loadShallowGrid : la lecture d'ERDDAP « 1 point sur 3 depuis le point le
* plus proche du bord sud / ouest », reproduite avec les départs relevés
* (`ties` : l'indice mondial du point ERDDAP le plus proche de chaque degré).
*/
function shallowFromTiles(bbox, tiles, ties, { cellDeg = .01, minDepth = 20 } = {}) {
	const [w, s, e, n] = bbox;
	if (!(minDepth >= 0) || minDepth > 200 || Math.abs(minDepth / 5 - Math.round(minDepth / 5)) > 1e-9) throw Object.assign(/* @__PURE__ */ new Error(`fonds minimaux de ${minDepth} m : hors ligne, un multiple de 5 jusqu'à 200 m`), { code: "charts-depth" });
	const M = Math.round(minDepth / 5);
	const Is = ties.lat[s];
	const In = ties.lat[n];
	const Jw = ties.lon[w];
	const Je = ties.lon[e];
	if ([
		Is,
		In,
		Jw,
		Je
	].some((v) => !Number.isInteger(v))) throw Object.assign(/* @__PURE__ */ new Error("fonds : départ de lecture inconnu pour cette emprise"), { code: "no-charts" });
	const nrows = Math.floor((In - Is) / 3) + 1;
	const ncols = Math.floor((Je - Jw) / 3) + 1;
	const yll = (Is + .5) * SUB - 90;
	const xll = (Jw + .5) * SUB - 180;
	const cols = Math.ceil((e - w) / cellDeg);
	const rows = Math.ceil((n - s) / cellDeg);
	const grid = new Uint8Array(cols * rows);
	const list = [...tiles.values()].filter((t) => t.etopo);
	const sample = (I, J) => {
		for (const t of list) {
			const r = I - t.etopo.i0;
			const c = J - t.etopo.j0;
			if (r >= 0 && c >= 0 && r < t.etopo.rows && c < t.etopo.cols) return t.etopo.cls[r * t.etopo.cols + c];
		}
		throw Object.assign(/* @__PURE__ */ new Error(`fonds : point ${I}, ${J} hors des tuiles`), { code: "no-charts" });
	};
	for (let r2 = 0; r2 < rows; r2++) {
		const lat = s + (r2 + .5) * cellDeg;
		const k = Math.round((lat - yll) / ETOPO_STEP);
		const gi = nrows - 1 - k;
		if (gi < 0 || gi >= nrows) continue;
		const I = Is + 3 * k;
		for (let c = 0; c < cols; c++) {
			const lon = w + (c + .5) * cellDeg;
			const gj = Math.round((lon - xll) / ETOPO_STEP);
			if (gj < 0 || gj >= ncols) continue;
			const m = sample(I, Jw + 3 * gj);
			if (m >= 1 && m <= M) grid[r2 * cols + c] = 1;
		}
	}
	return grid;
}
/** Overpass `way(bbox)` : une voie dont un sommet est dedans, ou dont un segment traverse l'emprise. */
function wayTouchesBbox(geometry, bbox) {
	const [w, s, e, n] = bbox;
	const inside = (p) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;
	if (geometry.some(inside)) return true;
	const segBox = (a, b) => {
		let t0 = 0;
		let t1 = 1;
		const dx = b.lon - a.lon;
		const dy = b.lat - a.lat;
		const clip = (p, q) => {
			if (p === 0) return q >= 0;
			const r = q / p;
			if (p < 0) {
				if (r > t1) return false;
				if (r > t0) t0 = r;
			} else {
				if (r < t0) return false;
				if (r < t1) t1 = r;
			}
			return true;
		};
		return clip(-dx, a.lon - w) && clip(dx, e - a.lon) && clip(-dy, a.lat - s) && clip(dy, n - a.lat) && t0 <= t1;
	};
	for (let i = 1; i < geometry.length; i++) if (segBox(geometry[i - 1], geometry[i])) return true;
	return false;
}
/** Les zones interdites de l'emprise, comme loadTss (mêmes textes de source). */
function tssFromElements(bbox, elements) {
	const rings = tssPolygonsFromOsm((elements || []).filter((el) => Array.isArray(el.geometry) && el.geometry.length && wayTouchesBbox(el.geometry, bbox)));
	if (!rings.length) return {
		rings: [],
		source: "OpenSeaMap (aucun dispositif dans la zone)"
	};
	return {
		rings,
		source: `OpenSeaMap (${rings.length} zones)`
	};
}
/**
* Les `sources` de loadCharts (lib/charts.mjs) à partir des tuiles chargées.
* charts = { index (index.json), tiles: Map(clé → decodeTile), tss: [éléments OSM] }
*/
function tileChartSources(charts) {
	const need = (bbox) => {
		const cov = coverage(bbox, charts.index);
		if (!cov.ok) throw Object.assign(/* @__PURE__ */ new Error(`pas de carte hors ligne pour cette zone (${cov.missing.join(", ") || "bords"})`), {
			code: "no-charts",
			missing: cov.missing
		});
	};
	return {
		async coastMask(bbox, { cellDeg = .01 } = {}) {
			need(bbox);
			return {
				mask: maskFromTiles(bbox, charts.tiles, cellDeg),
				source: "OpenStreetMap"
			};
		},
		async shallowGrid(bbox, { cellDeg = .01, minDepth = 20 } = {}) {
			need(bbox);
			return {
				grid: shallowFromTiles(bbox, charts.tiles, charts.index.ties, {
					cellDeg,
					minDepth
				}),
				source: "ETOPO 2022 (GEBCO)"
			};
		},
		async tss(bbox) {
			need(bbox);
			return tssFromElements(bbox, charts.tss);
		},
		async coastIndex(bbox) {
			need(bbox);
			return indexFromEdges(edgesFromTiles(bbox, charts.tiles), bbox, .05);
		}
	};
}
var toF64 = (nested, T, I, J) => {
	const out = new Float64Array(T * I * J);
	for (let t = 0; t < T; t++) for (let i = 0; i < I; i++) for (let j = 0; j < J; j++) {
		const v = nested?.[t]?.[i]?.[j];
		out[(t * I + i) * J + j] = v == null || !Number.isFinite(v) ? NaN : v;
	}
	return out;
};
/** Une grille du moteur (tableaux imbriqués, null = absent) → compacte. */
function compactWind(g) {
	const T = g.times.length;
	const I = g.lats.length;
	const J = g.lons.length;
	return {
		model: g.model,
		lats: [...g.lats],
		lons: [...g.lons],
		times: Float64Array.from(g.times),
		u: toF64(g.u, T, I, J),
		v: toF64(g.v, T, I, J),
		gust: g.gust ? toF64(g.gust, T, I, J) : null,
		fetchedAt: g.fetchedAt || null
	};
}
function compactWaves(g) {
	if (!g) return null;
	const T = g.times.length;
	const I = g.lats.length;
	const J = g.lons.length;
	return {
		lats: [...g.lats],
		lons: [...g.lons],
		times: Float64Array.from(g.times),
		hs: toF64(g.hs, T, I, J),
		fetchedAt: g.fetchedAt || null
	};
}
/** Les indices d'un axe à l'intérieur de [lo, hi] (à 1e-9 près). */
function inside(axis, lo, hi) {
	const out = [];
	for (let k = 0; k < axis.length; k++) if (axis[k] >= lo - 1e-9 && axis[k] <= hi + 1e-9) out.push(k);
	return out;
}
var nest = (flat, T, I, J, ii, jj) => {
	const out = new Array(T);
	for (let t = 0; t < T; t++) {
		const rows = new Array(ii.length);
		for (let a = 0; a < ii.length; a++) {
			const row = new Array(jj.length);
			const base = (t * I + ii[a]) * J;
			for (let b = 0; b < jj.length; b++) {
				const v = flat[base + jj[b]];
				row[b] = Number.isNaN(v) ? null : v;
			}
			rows[a] = row;
		}
		out[t] = rows;
	}
	return out;
};
/** L'âge (h) d'une grille du paquet à `nowMs`. */
var ageH = (fetchedAt, nowMs = Date.now()) => {
	const t = Date.parse(fetchedAt || "");
	return Number.isFinite(t) ? Math.max(0, (nowMs - t) / 36e5) : null;
};
/** La marque « météo d'avant » du moteur (weatherFreshness, ROUTE-013) si la grille a plus de 3 h. */
function staleMark(fetchedAt, nowMs, reason) {
	const a = ageH(fetchedAt, nowMs);
	if (a == null || a <= 3) return null;
	return {
		fetchedAt,
		ageH: Math.round(a * 10) / 10,
		reason
	};
}
/** Le vent d'un modèle du paquet, découpé à l'emprise, au format du moteur (fetchWindGrid). */
function windGridFor(pack, model, bbox, { nowMs = Date.now() } = {}) {
	const c = pack?.grids?.[model];
	if (!c) throw Object.assign(/* @__PURE__ */ new Error(`le paquet météo n'a pas ${model}`), { code: "no-pack-model" });
	const [w, s, e, n] = bbox;
	const ii = inside(c.lats, s, n);
	const jj = inside(c.lons, w, e);
	if (ii.length < 2 || jj.length < 2) throw Object.assign(/* @__PURE__ */ new Error("le paquet météo ne couvre pas ce passage"), { code: "no-pack-coverage" });
	const T = c.times.length;
	const I = c.lats.length;
	const J = c.lons.length;
	const g = {
		model,
		lats: ii.map((k) => c.lats[k]),
		lons: jj.map((k) => c.lons[k]),
		times: Array.from(c.times),
		u: nest(c.u, T, I, J, ii, jj),
		v: nest(c.v, T, I, J, ii, jj),
		gust: c.gust ? nest(c.gust, T, I, J, ii, jj) : Array.from({ length: T }, () => ii.map(() => jj.map(() => null))),
		fetchedAt: c.fetchedAt
	};
	const st = staleMark(c.fetchedAt, nowMs, pack.kind === "grib" ? "GRIB importé" : "paquet météo de l'appareil");
	if (st) g.stale = st;
	return g;
}
/** Les vagues du paquet, découpées (fetchWaveGrid) — null si le paquet n'en a pas (un GRIB de vent seul). */
function waveGridFor(pack, bbox, { nowMs = Date.now() } = {}) {
	const c = pack?.waves;
	if (!c) return null;
	const [w, s, e, n] = bbox;
	const ii = inside(c.lats, s, n);
	const jj = inside(c.lons, w, e);
	if (ii.length < 2 || jj.length < 2) return null;
	const T = c.times.length;
	const I = c.lats.length;
	const J = c.lons.length;
	const g = {
		lats: ii.map((k) => c.lats[k]),
		lons: jj.map((k) => c.lons[k]),
		times: Array.from(c.times),
		hs: nest(c.hs, T, I, J, ii, jj),
		fetchedAt: c.fetchedAt
	};
	const st = staleMark(c.fetchedAt, nowMs, pack.kind === "grib" ? "GRIB importé" : "paquet météo de l'appareil");
	if (st) g.stale = st;
	return g;
}
/** L'emprise couverte par une grille compacte [O, S, E, N]. */
var extentOf = (c) => [
	Math.min(...c.lons),
	Math.min(...c.lats),
	Math.max(...c.lons),
	Math.max(...c.lats)
];
/**
* Le paquet couvre-t-il ce passage ? → { ok, models: [ceux qui couvrent], partial, reason?, horizonMs }.
* Un modèle couvre si sa grille contient l'emprise du passage (`full`) — ou, à
* défaut (un GRIB découpé au plus près de la route), le départ et l'arrivée
* avec une marge de `marginDeg` : la route ne sortira pas de la grille (hors
* de la météo, le moteur ne va pas), et le résultat le dit (`partial`).
*/
function packCoverage(pack, bbox, { from = null, to = null, marginDeg = .5 } = {}) {
	if (!pack?.grids) return {
		ok: false,
		models: [],
		reason: "no-pack"
	};
	const [w, s, e, n] = bbox;
	const full = [];
	const part = [];
	let horizonMs = null;
	const holds = (ext, p) => p && p.lon >= ext[0] + marginDeg - 1e-9 && p.lon <= ext[2] - marginDeg + 1e-9 && p.lat >= ext[1] + marginDeg - 1e-9 && p.lat <= ext[3] - marginDeg + 1e-9;
	for (const [m, c] of Object.entries(pack.grids)) {
		const ext = extentOf(c);
		const [W, S, E, N] = ext;
		if (W <= w + 1e-9 && S <= s + 1e-9 && E >= e - 1e-9 && N >= n - 1e-9) full.push(m);
		else if (holds(ext, from) && holds(ext, to)) part.push(m);
		else continue;
		const end = c.times[c.times.length - 1];
		horizonMs = horizonMs == null ? end : Math.max(horizonMs, end);
	}
	const models = full.length ? full : part;
	return models.length ? {
		ok: true,
		models,
		partial: !full.length,
		horizonMs
	} : {
		ok: false,
		models,
		reason: "no-pack-coverage"
	};
}
/** Le résumé d'un paquet pour l'écran (sans les grilles). */
function packSummary(pack, nowMs = Date.now()) {
	if (!pack) return null;
	const models = Object.keys(pack.grids || {});
	const times = models.flatMap((m) => [pack.grids[m].times[0], pack.grids[m].times[pack.grids[m].times.length - 1]]);
	const fetched = models.map((m) => Date.parse(pack.grids[m].fetchedAt || "")).filter(Number.isFinite);
	const oldest = fetched.length ? Math.min(...fetched) : null;
	return {
		id: pack.id,
		name: pack.name || null,
		kind: pack.kind,
		bbox: pack.bbox,
		models,
		labels: pack.labels || {},
		waves: Boolean(pack.waves),
		fromMs: times.length ? Math.min(...times) : null,
		toMs: times.length ? Math.max(...times) : null,
		fetchedAt: oldest ? new Date(oldest).toISOString() : null,
		ageH: oldest ? Math.round((nowMs - oldest) / 36e5 * 10) / 10 : null,
		stale: oldest ? (nowMs - oldest) / 36e5 > 3 : true,
		bytes: pack.bytes || null,
		partial: pack.partial || [],
		source: pack.source || null,
		createdAt: pack.createdAt || null
	};
}
/** La taille (octets) d'un paquet compact, à peu près (les tableaux de doubles). */
function packBytes(pack) {
	let b = 0;
	for (const c of Object.values(pack?.grids || {})) b += (c.u?.byteLength || 0) + (c.v?.byteLength || 0) + (c.gust?.byteLength || 0) + (c.times?.byteLength || 0);
	if (pack?.waves) b += (pack.waves.hs?.byteLength || 0) + (pack.waves.times?.byteLength || 0);
	return b;
}
/** La météo d'un calcul local, pour le résultat (`result.localWeather`) et la pastille. */
function weatherSourceOf(pack, models, nowMs = Date.now()) {
	const s = packSummary(pack, nowMs);
	return {
		kind: pack.kind === "grib" ? "grib" : "pack",
		packId: pack.id,
		name: pack.name || null,
		fetchedAt: s.fetchedAt,
		ageH: s.ageH,
		models: models.map((m) => ({
			id: m,
			label: pack.labels?.[m] || null
		})),
		waves: Boolean(pack.waves),
		...pack.kind === "grib" ? { files: (pack.source?.files || []).map((f) => ({
			name: f.name,
			edition: f.edition,
			center: f.center ?? null,
			runs: f.runs || []
		})) } : {}
	};
}
//#endregion
//#region src/lib/localRouting/localIO.js
/** D29 bis — ce qui reste AU NUAGE, partout ailleurs : les ensembles (173 scénarios ; un paquet n'en a pas). */
var CLOUD_ONLY = ["ensembles"];
/** D29 bis — les sensibilités qui tournent partout (deux routes chacune, la météo déjà là). */
var LOCAL_SENS = ["polar", "crew"];
/** D29 bis — la recherche du départ : la grille D22, et le plan des départs (≈ 100 routes isochrones, avec la grille complète seulement). */
var GRID_OPTIONS = ["bestDeparture", "departures"];
/** D29 bis — la grille LÉGÈRE : ±12 h (9 départs, toutes les 3 h), l'objectif choisi + Rapide, 120 s au plus. */
var LIGHT_GRID = {
	windowH: 24,
	budgetMs: 12e4
};
/** D29 — tout ce qui était retiré sur l'appareil avant D29 bis ; encore utilisé par `stripHeavy: true` (la reprise « Rapide seul »). */
var DEVICE_STRIPPED = [
	"polar",
	"departures",
	"ensembles",
	"bestDeparture",
	"crew"
];
var H = 36e5;
/**
* D29 bis — LA GRILLE LÉGÈRE (pur) : la demande `bestDeparture` ramenée à ±12 h
* autour du même centre (le centre demandé — `when.centerMs` —, sinon le début
* de la fenêtre ; jamais avant le début demandé), les lignes = l'objectif choisi
* + Rapide. → { bestDeparture, departMs, when, cap }
*/
function lightGrid(req, nowMs = Date.now()) {
	const bd = req?.options?.bestDeparture && typeof req.options.bestDeparture === "object" ? req.options.bestDeparture : {};
	const asked = Math.max(0, Number(bd.windowH) || 48);
	const start0 = Number.isFinite(req?.departMs) ? req.departMs : nextHour(nowMs);
	const windowH = Math.min(asked, LIGHT_GRID.windowH);
	let start = start0;
	if (asked > windowH) {
		const centre = Number.isFinite(Number(req?.when?.centerMs)) ? Number(req.when.centerMs) : start0;
		start = Math.max(start0, Math.min(start0 + (asked - windowH) * H, Math.round((centre - windowH / 2 * H) / H) * H));
	}
	const profile = prefsOf({
		...DEFAULT_LIMITS,
		...req?.limits || {}
	}).profile;
	const rows = [...new Set([profile, "rapide"])];
	const when = req?.when && typeof req.when === "object" ? {
		...req.when,
		halfH: Math.min(Number(req.when.halfH) || windowH / 2, windowH / 2)
	} : req?.when;
	return {
		bestDeparture: {
			...bd,
			windowH,
			rows
		},
		departMs: start,
		when,
		cap: {
			profile: "light",
			rows,
			windowH,
			askedH: asked,
			...start !== start0 ? { shiftedH: Math.round((start - start0) / H) } : {}
		}
	};
}
/** L'ordre des modèles du service (MODELS de weather.mjs), puis les autres (GRIB). */
var modelOrder = (list) => {
	const known = Object.keys(MODELS).filter((m) => list.includes(m));
	return [...known, ...list.filter((m) => !known.includes(m))];
};
/**
* Les cartes pour une emprise, chargées à la demande par un `store` :
*   store = { index() → index.json, tile(clé, méta) → octets décompressés, tss() → { elements } }
*/
function tileCharts(store) {
	const charts = {
		index: null,
		tiles: /* @__PURE__ */ new Map(),
		tss: null
	};
	const ensure = async (bbox) => {
		if (!charts.index) charts.index = await store.index();
		const cov = coverage(bbox, charts.index);
		if (!cov.ok) throw Object.assign(/* @__PURE__ */ new Error(`pas de carte hors ligne pour cette zone${cov.missing.length ? ` (tuiles ${cov.missing.join(", ")})` : ""}`), {
			code: "no-charts",
			missing: cov.missing
		});
		for (const k of tilesFor(bbox)) if (!charts.tiles.has(k)) charts.tiles.set(k, decodeTile(await store.tile(k, charts.index.tiles[k])));
		if (!charts.tss) charts.tss = (await store.tss(charts.index.tss)).elements || [];
	};
	const base = tileChartSources(charts);
	return {
		charts,
		ensure,
		sources: {
			coastMask: async (bbox, o) => {
				await ensure(bbox);
				return base.coastMask(bbox, o);
			},
			shallowGrid: async (bbox, o) => {
				await ensure(bbox);
				return base.shallowGrid(bbox, o);
			},
			tss: async (bbox, o) => {
				await ensure(bbox);
				return base.tss(bbox, o);
			},
			coastIndex: async (bbox, o) => {
				await ensure(bbox);
				return base.coastIndex(bbox, o);
			}
		}
	};
}
/**
* D26 « 🗄 météo précédente » sur l'appareil : LE PAQUET, quel que soit son âge
* (rien n'est jamais téléchargé ici), marqué `previous` comme le cache du service
* (weather.mjs previousGrid) — l'âge est dit, la confiance baisse avec. Pur.
*/
function previousFromPack(pack, kind, bbox, nowMs = Date.now()) {
	let g = null;
	try {
		g = kind === "waves" ? waveGridFor(pack, bbox, { nowMs }) : kind.startsWith("wind-") ? windGridFor(pack, kind.slice(5), bbox, { nowMs }) : null;
	} catch {
		g = null;
	}
	if (!g) return null;
	const { stale, ...grid } = g;
	const at = Date.parse(grid.fetchedAt || "");
	grid.previous = {
		fetchedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
		ageH: Number.isFinite(at) ? Math.round((nowMs - at) / 36e4) / 10 : null,
		file: pack?.kind === "grib" ? "grib" : "pack"
	};
	return grid;
}
/** Le `io` de computeAdvice pour un calcul local. */
function localIO({ pack, store, createPool, timezoneAt = async () => null, nowMs = Date.now(), models }) {
	const tc = tileCharts(store);
	return {
		loadCharts: (bbox, opts) => loadCharts(bbox, {
			...opts,
			sources: tc.sources
		}),
		fetchWindGrid: async (model, bbox) => windGridFor(pack, model, bbox, { nowMs }),
		fetchWaveGrid: async (bbox) => waveGridFor(pack, bbox, { nowMs }),
		previousGrid: (cacheDir, kind, bbox, step, days, now = nowMs) => previousFromPack(pack, kind, bbox, now),
		previousEnsembleGrids: async () => null,
		...createPool ? { createPool } : {},
		resolvePlace: async (v) => {
			throw Object.assign(/* @__PURE__ */ new Error(`lieu « ${v} » : hors ligne, un point (lat, lon) est nécessaire`), { code: "place" });
		},
		timezoneAt: async (lat, lon) => {
			try {
				return await timezoneAt(lat, lon);
			} catch {
				return null;
			}
		},
		models,
		modelInfo: (m) => ({
			label: pack?.labels?.[m] || m,
			kind: pack?.kind === "grib" ? "GRIB" : "physique"
		}),
		_charts: tc
	};
}
/**
* Un conseil calculé ici (le navigateur ou le PC du bord).
* opts = { pack, store, createPool?, timezoneAt?, threads, nowMs, onStep, log, polar, astarBudgetMs,
*          computedOn: 'device' | 'boat-pc', maxModels?, maxRoutes?,
*          grid?: 'off' | 'light' | 'full' (D29 bis — défaut : 'full' au PC du bord, 'off' ailleurs),
*          sens?: false (⛵ 😴 retirées — la reprise « Rapide seul »), departBudgetMs?, shouldStop?,
*          stripHeavy?: true (tout ce que D29 retirait — la reprise « Rapide seul ») }
*/
async function computeLocal(request, opts) {
	const { pack, computedOn = "device", nowMs = Date.now(), maxModels = null, maxRoutes = null, noOptimiser = false } = opts;
	const stripHeavy = opts.stripHeavy === true;
	const grid = [
		"off",
		"light",
		"full"
	].includes(opts.grid) ? opts.grid : computedOn === "boat-pc" ? "full" : "off";
	const sensOk = opts.sens !== false;
	const from = request?.from;
	const to = request?.to;
	if (!(from && Number.isFinite(from.lat) && to && Number.isFinite(to.lat))) throw Object.assign(/* @__PURE__ */ new Error("hors ligne, le départ et l'arrivée doivent être des points (lat, lon)"), { code: "place" });
	const bbox = passageBbox(from, to);
	const dummy = normalizeWeatherSource(request.weatherSource).source === "dummy";
	const cov = dummy ? {
		ok: true,
		models: Object.keys(MODELS),
		partial: false
	} : packCoverage(pack, bbox, {
		from,
		to
	});
	if (!cov.ok) throw Object.assign(/* @__PURE__ */ new Error(cov.reason === "no-pack" ? "pas de météo sur cet appareil" : "la météo de l'appareil ne couvre pas ce passage"), {
		code: cov.reason,
		bbox
	});
	let models = modelOrder(cov.models);
	if (maxModels && models.length > maxModels) models = models.slice(0, maxModels);
	const req = { ...request };
	const caps = {};
	if (maxRoutes && (req.limits?.routesShown == null || req.limits.routesShown > maxRoutes)) {
		caps.routesShown = maxRoutes;
		req.limits = {
			...req.limits || {},
			routesShown: maxRoutes
		};
	}
	const stripped = [];
	if (req.options) {
		req.options = { ...req.options };
		const strip = (k) => {
			if (req.options[k]) {
				stripped.push(k);
				delete req.options[k];
			}
		};
		if (stripHeavy) DEVICE_STRIPPED.forEach(strip);
		CLOUD_ONLY.forEach(strip);
		if (!sensOk) LOCAL_SENS.forEach(strip);
		if (grid === "off") GRID_OPTIONS.forEach(strip);
		if (grid === "light") {
			strip("departures");
			if (req.options.bestDeparture) {
				const l = lightGrid(req, nowMs);
				req.options.bestDeparture = l.bestDeparture;
				req.departMs = l.departMs;
				if (l.when !== void 0) req.when = l.when;
				caps.grid = l.cap;
			}
		}
		if (grid === "full" && req.options.bestDeparture) caps.grid = { profile: "full" };
	}
	if (cov.models.length > models.length) caps.models = models.length;
	if (noOptimiser) {
		req.options = {
			...req.options || {},
			optimiser: false
		};
		caps.noOptimiser = true;
	}
	const io = localIO({
		pack,
		store: opts.store,
		createPool: opts.createPool,
		timezoneAt: opts.timezoneAt,
		nowMs,
		models
	});
	const departBudgetMs = opts.departBudgetMs || (caps.grid?.profile === "light" ? LIGHT_GRID.budgetMs : null);
	if (caps.grid && departBudgetMs) caps.grid.budgetS = Math.round(departBudgetMs / 1e3);
	const result = await computeAdvice(req, {
		io,
		threads: opts.threads,
		nowMs,
		onStep: opts.onStep,
		log: opts.log || (() => {}),
		polar: opts.polar || null,
		engineUsage: opts.engineUsage || null,
		...opts.astarBudgetMs ? { astarBudgetMs: opts.astarBudgetMs } : {},
		...departBudgetMs ? { departBudgetMs } : {},
		...typeof opts.shouldStop === "function" ? { shouldStop: opts.shouldStop } : {}
	});
	result.computedOn = computedOn;
	result.localWeather = dummy ? {
		kind: "dummy",
		models: models.map((m) => ({
			id: m,
			label: null
		})),
		waves: true
	} : {
		...weatherSourceOf(pack, models, nowMs),
		...cov.partial ? { partial: true } : {}
	};
	if (result.options && stripped.length) result.options = {
		...result.options,
		stripped: [...result.options.stripped || [], ...stripped],
		strippedWhy: computedOn
	};
	if (Object.keys(caps).length) result.deviceCaps = caps;
	return result;
}
//#endregion
//#region src/lib/localRouting/grib.js
var KN = 3600 / 1852;
var u8 = (b, o) => b[o];
var u16 = (b, o) => b[o] << 8 | b[o + 1];
var u24 = (b, o) => b[o] << 16 | b[o + 1] << 8 | b[o + 2];
var u32 = (b, o) => (b[o] << 24 >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
var s16 = (b, o) => {
	const v = u16(b, o);
	return v & 32768 ? -(v & 32767) : v;
};
var s24 = (b, o) => {
	const v = u24(b, o);
	return v & 8388608 ? -(v & 8388607) : v;
};
var s32 = (b, o) => {
	const v = u32(b, o);
	return v >= 2147483648 ? -(v - 2147483648) : v;
};
var f32 = (b, o) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, false);
/** Le flottant IBM 32 bits du GRIB1 (base 16). */
function ibm32(b, o) {
	const sign = b[o] & 128 ? -1 : 1;
	const exp = (b[o] & 127) - 64;
	return sign * ((b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) / 16777216) * 16 ** exp;
}
/** Un lecteur de bits (le plus fort d'abord). */
var Bits = class {
	constructor(b, byteOff = 0, byteEnd = b.length) {
		this.b = b;
		this.pos = byteOff * 8;
		this.end = byteEnd * 8;
	}
	read(n) {
		if (n === 0) return 0;
		let v = 0;
		for (let k = 0; k < n; k++) {
			const p = this.pos++;
			if (p >= this.end) throw Object.assign(/* @__PURE__ */ new Error("GRIB : données tronquées"), { code: "grib-truncated" });
			v = v * 2 + (this.b[p >> 3] >> 7 - (p & 7) & 1);
		}
		return v;
	}
	/** Lecture rapide de n ≤ 24 bits. */
	read24(n) {
		if (n === 0) return 0;
		const p = this.pos;
		const end = p + n;
		if (end > this.end) throw Object.assign(/* @__PURE__ */ new Error("GRIB : données tronquées"), { code: "grib-truncated" });
		const i = p >> 3;
		const b = this.b;
		const w = (b[i] << 24 | (b[i + 1] ?? 0) << 16 | (b[i + 2] ?? 0) << 8 | (b[i + 3] ?? 0)) >>> 0;
		this.pos = end;
		return w >>> 32 - (p & 7) - n & 2 ** n - 1;
	}
	get(n) {
		return n <= 24 ? this.read24(n) : this.read(n);
	}
	align() {
		this.pos = this.pos + 7 & -8;
	}
	/** Le nombre de zéros avant le prochain 1 (une séquence fondamentale de CCSDS). */
	fs() {
		let z = 0;
		while (true) {
			const p = this.pos++;
			if (p >= this.end) throw Object.assign(/* @__PURE__ */ new Error("GRIB : données tronquées"), { code: "grib-truncated" });
			if (this.b[p >> 3] >> 7 - (p & 7) & 1) return z;
			z++;
		}
	}
};
var unsupported = (why, code = "grib-unsupported") => Object.assign(new Error(why), { code });
function param2(disc, cat, num) {
	if (disc === 0 && cat === 2) {
		if (num === 2) return "u";
		if (num === 3) return "v";
		if (num === 22) return "gust";
		if (num === 1) return "ws";
		if (num === 0) return "wd";
	}
	if (disc === 10 && cat === 0) {
		if (num === 3) return "swh";
	}
	return null;
}
function param1(table, ind, center) {
	if (center === 98 && table === 128) return {
		165: "u",
		166: "v",
		49: "gust",
		207: "ws"
	}[ind] || null;
	if (center === 98 && table === 140) return ind === 229 ? "swh" : null;
	if (table <= 3 || center !== 98) return {
		33: "u",
		34: "v",
		32: "ws",
		31: "wd",
		180: "gust",
		100: "swh"
	}[ind] || null;
	return null;
}
/** Les latitudes / longitudes d'une grille régulière, et l'ordre des valeurs → l'index [lat croissante][lon croissante]. */
function regularGrid({ ni, nj, la1, lo1, la2, lo2, di, dj, scan }) {
	const iNeg = Boolean(scan & 128);
	const jPos = Boolean(scan & 64);
	const jCons = Boolean(scan & 32);
	const boustro = Boolean(scan & 16);
	const span = (a, b, n, neg) => {
		let d = neg ? a - b : b - a;
		if (!neg && d < 0) d += 360;
		if (neg && d < 0) d += 360;
		return n > 1 ? d / (n - 1) : 0;
	};
	const dLon = di > 0 && Math.abs(di * (ni - 1) - span(lo1, lo2, ni, iNeg)) < .001 ? di : span(lo1, lo2, ni, iNeg);
	const dLat = dj > 0 && Math.abs(dj * (nj - 1) - Math.abs(la2 - la1)) < .001 ? dj : nj > 1 ? Math.abs(la2 - la1) / (nj - 1) : 0;
	const lonAt = (i) => lo1 + (iNeg ? -1 : 1) * i * dLon;
	const latAt = (j) => la1 + (jPos ? 1 : -1) * j * dLat;
	const rawLons = Array.from({ length: ni }, (_, i) => lonAt(i));
	const norm = (x) => ((x + 180) % 360 + 360) % 360 - 180;
	const uniform = (a) => a.length < 3 || a.every((x, k) => k === 0 || Math.abs(x - a[k - 1] - (a[1] - a[0])) < 1e-6);
	let lons = rawLons.map(norm);
	if (!uniform([...lons].sort((a, b) => a - b))) lons = rawLons.slice();
	const lats = Array.from({ length: nj }, (_, j) => latAt(j));
	const lonOrder = lons.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
	const latOrder = lats.map((x, j) => [x, j]).sort((a, b) => a[0] - b[0]);
	const round = (x) => Math.round(x * 1e6) / 1e6;
	const src = (jFile, iFile) => {
		let i = iFile;
		if (boustro && jFile % 2 === 1) i = ni - 1 - iFile;
		return jCons ? i * nj + jFile : jFile * ni + i;
	};
	return {
		ni,
		nj,
		lats: latOrder.map(([x]) => round(x)),
		lons: lonOrder.map(([x]) => round(x)),
		reorder(values) {
			const out = new Float64Array(ni * nj);
			for (let a = 0; a < nj; a++) {
				const jf = latOrder[a][1];
				for (let b = 0; b < ni; b++) out[a * ni + b] = values[src(jf, lonOrder[b][1])];
			}
			return out;
		}
	};
}
/** Le temps d'un GRIB2 / GRIB1 (unité du code 4.4 / table 4) → millisecondes. */
var UNIT_MS = {
	0: 6e4,
	1: 36e5,
	2: 864e5,
	10: 3 * 36e5,
	11: 6 * 36e5,
	12: 12 * 36e5,
	13: 1e3,
	254: 1e3
};
function parseGrib2(b, start, total, out) {
	const end = start + total;
	const msg = {
		edition: 2,
		discipline: u8(b, start + 6)
	};
	let p = start + 16;
	let grid = null;
	let bitmap = null;
	let drs = null;
	let prod = null;
	while (p < end - 4) {
		if (b[p] === 55 && b[p + 1] === 55 && b[p + 2] === 55 && b[p + 3] === 55) break;
		const len = u32(b, p);
		const num = u8(b, p + 4);
		if (len < 5 || p + len > end) throw unsupported("GRIB2 : section illisible", "grib-format");
		if (num === 1) {
			msg.center = u16(b, p + 5);
			msg.subCenter = u16(b, p + 7);
			msg.refMs = Date.UTC(u16(b, p + 12), u8(b, p + 14) - 1, u8(b, p + 15), u8(b, p + 16), u8(b, p + 17), u8(b, p + 18));
		} else if (num === 3) {
			const tpl = u16(b, p + 12);
			if (tpl !== 0) grid = { unsupported: `grille 3.${tpl}` };
			else {
				const basic = u32(b, p + 38);
				const sub = u32(b, p + 42);
				const unit = basic === 0 || basic === 4294967295 || sub === 0 || sub === 4294967295 ? 1e-6 : basic / sub;
				grid = {
					ni: u32(b, p + 30),
					nj: u32(b, p + 34),
					la1: s32(b, p + 46) * unit,
					lo1: s32(b, p + 50) * unit,
					la2: s32(b, p + 55) * unit,
					lo2: s32(b, p + 59) * unit,
					di: u32(b, p + 63) === 4294967295 ? 0 : u32(b, p + 63) * unit,
					dj: u32(b, p + 67) === 4294967295 ? 0 : u32(b, p + 67) * unit,
					scan: u8(b, p + 71),
					npts: u32(b, p + 6)
				};
			}
		} else if (num === 4) {
			const tpl = u16(b, p + 7);
			prod = { tpl };
			if ([
				0,
				1,
				8,
				11
			].includes(tpl)) {
				prod.cat = u8(b, p + 9);
				prod.num = u8(b, p + 10);
				prod.process = u8(b, p + 13);
				const unitCode = u8(b, p + 17);
				const ft = s32(b, p + 18);
				prod.leadMs = UNIT_MS[unitCode] != null ? ft * UNIT_MS[unitCode] : null;
				prod.surf = u8(b, p + 22);
				const sc = u8(b, p + 23);
				const sv = s32(b, p + 24);
				prod.level = sv === -2147483647 || sc === 255 ? null : sv / 10 ** (sc > 127 ? -(sc - 128) : sc);
				const endAt = tpl === 8 ? p + 34 : tpl === 11 ? p + 37 : null;
				if (endAt) prod.endMs = Date.UTC(u16(b, endAt), u8(b, endAt + 2) - 1, u8(b, endAt + 3), u8(b, endAt + 4), u8(b, endAt + 5), u8(b, endAt + 6));
			}
		} else if (num === 5) {
			const tpl = u16(b, p + 9);
			drs = {
				tpl,
				n: u32(b, p + 5),
				R: f32(b, p + 11),
				E: s16(b, p + 15),
				D: s16(b, p + 17),
				nbits: u8(b, p + 19)
			};
			if (tpl === 2 || tpl === 3) Object.assign(drs, {
				missMgmt: u8(b, p + 22),
				ng: u32(b, p + 31),
				refW: u8(b, p + 35),
				bitsW: u8(b, p + 36),
				refL: u32(b, p + 37),
				incL: u8(b, p + 41),
				lastL: u32(b, p + 42),
				bitsL: u8(b, p + 46),
				...tpl === 3 ? {
					order: u8(b, p + 47),
					extra: u8(b, p + 48)
				} : {}
			});
			else if (tpl === 42) Object.assign(drs, {
				flags: u8(b, p + 21),
				block: u8(b, p + 22),
				rsi: u16(b, p + 23)
			});
		} else if (num === 6) {
			const ind = u8(b, p + 5);
			if (ind === 0) bitmap = b.subarray(p + 6, p + len);
			else if (ind === 254) bitmap = out.lastBitmap || null;
			else bitmap = null;
			out.lastBitmap = bitmap;
		} else if (num === 7) {
			const one = {
				...msg,
				process: prod?.process ?? null,
				cat: prod?.cat,
				num: prod?.num,
				surf: prod?.surf,
				level: prod?.level ?? null,
				packing: drs ? `5.${drs.tpl}` : null
			};
			one.param = prod ? param2(msg.discipline, prod.cat, prod.num) : null;
			one.validMs = prod?.endMs ?? (prod?.leadMs != null ? msg.refMs + prod.leadMs : null);
			const atTen = one.param === "swh" || prod?.surf === 103 && one.level === 10 || one.param === "gust" && (prod?.surf === 1 || prod?.surf === 103);
			if (!one.param) one.skip = "paramètre";
			else if (!atTen) one.skip = `niveau ${prod?.surf}/${one.level}`;
			else if (!grid || grid.unsupported) one.skip = grid?.unsupported || "grille";
			else if (!drs) one.skip = "compression";
			else try {
				const raw = unpack2(b, p + 5, p + len, drs, bitmap, grid.ni * grid.nj);
				const g = regularGrid(grid);
				one.grid = {
					lats: g.lats,
					lons: g.lons,
					ni: g.ni,
					nj: g.nj
				};
				one.values = g.reorder(raw);
			} catch (e) {
				one.skip = e.code === "grib-unsupported" ? e.message : `illisible (${e.message})`;
			}
			out.push(one);
		}
		p += len;
	}
}
/** Les valeurs d'un champ GRIB2 (section 7), dans l'ordre du fichier ; NaN aux points absents (bitmap). */
function unpack2(b, s, e, d, bitmap, npts) {
	let packed;
	if (d.tpl === 0) packed = simpleInts(b, s, e, d.n, d.nbits);
	else if (d.tpl === 2 || d.tpl === 3) packed = complexInts(b, s, e, d);
	else if (d.tpl === 42) packed = aecInts(b, s, e, d);
	else if (d.tpl === 40) throw unsupported("compression JPEG 2000 (5.40) non prise en charge");
	else if (d.tpl === 41) throw unsupported("compression PNG (5.41) non prise en charge");
	else throw unsupported(`compression 5.${d.tpl} non prise en charge`);
	const scale2 = 2 ** d.E;
	const dec = 10 ** -d.D;
	const vals = new Float64Array(packed.length);
	for (let k = 0; k < packed.length; k++) vals[k] = Number.isNaN(packed[k]) ? NaN : (d.R + packed[k] * scale2) * dec;
	return expandBitmap(vals, bitmap, npts);
}
function expandBitmap(vals, bitmap, npts) {
	if (!bitmap) return vals;
	const out = new Float64Array(npts);
	let k = 0;
	for (let i = 0; i < npts; i++) out[i] = bitmap[i >> 3] >> 7 - (i & 7) & 1 ? vals[k++] : NaN;
	return out;
}
function simpleInts(b, s, e, n, nbits) {
	const out = new Float64Array(n);
	if (nbits === 0) return out;
	const r = new Bits(b, s, e);
	for (let k = 0; k < n; k++) out[k] = r.get(nbits);
	return out;
}
/** 5.2 / 5.3 — la compression « complexe » de l'OMM (groupes), et les différences spatiales (la NOAA). */
function complexInts(b, s, e, d) {
	const r = new Bits(b, s, e);
	let ival1 = 0;
	let ival2 = 0;
	let minsd = 0;
	if (d.tpl === 3) {
		const nb = d.extra * 8;
		if (d.order === 1) ival1 = r.get(nb);
		else if (d.order === 2) {
			ival1 = r.get(nb);
			ival2 = r.get(nb);
		} else throw unsupported(`différences spatiales d'ordre ${d.order}`);
		const sign = r.get(1);
		minsd = r.get(nb - 1);
		if (sign) minsd = -minsd;
	}
	const ng = d.ng;
	const gref = new Float64Array(ng);
	for (let g = 0; g < ng; g++) gref[g] = r.get(d.nbits);
	r.align();
	const gw = new Float64Array(ng);
	for (let g = 0; g < ng; g++) gw[g] = r.get(d.bitsW) + d.refW;
	r.align();
	const gl = new Float64Array(ng);
	for (let g = 0; g < ng; g++) gl[g] = r.get(d.bitsL) * d.incL + d.refL;
	r.align();
	if (ng) gl[ng - 1] = d.lastL;
	const n = d.n;
	const out = new Float64Array(n);
	let k = 0;
	const miss1 = 2 ** d.nbits - 1;
	const miss2 = 2 ** d.nbits - 2;
	for (let g = 0; g < ng && k < n; g++) {
		const w = gw[g];
		const len = gl[g];
		if (w === 0) {
			const isM1 = d.missMgmt >= 1 && gref[g] === miss1;
			const isM2 = d.missMgmt === 2 && gref[g] === miss2;
			for (let q = 0; q < len && k < n; q++) out[k++] = isM1 || isM2 ? NaN : gref[g];
		} else {
			const m1 = 2 ** w - 1;
			const m2 = 2 ** w - 2;
			for (let q = 0; q < len && k < n; q++) {
				const x = r.get(w);
				out[k++] = d.missMgmt >= 1 && x === m1 || d.missMgmt === 2 && x === m2 ? NaN : x + gref[g];
			}
		}
	}
	if (d.tpl === 3) {
		let j = 0;
		let a = 0;
		let b2 = 0;
		for (let q = 0; q < n; q++) {
			if (Number.isNaN(out[q])) continue;
			if (d.order === 1) {
				if (j === 0) out[q] = ival1;
				else out[q] = out[q] + minsd + a;
				a = out[q];
			} else {
				if (j === 0) out[q] = ival1;
				else if (j === 1) out[q] = ival2;
				else out[q] = out[q] + minsd + 2 * a - b2;
				b2 = a;
				a = out[q];
			}
			j++;
		}
	}
	return out;
}
/**
* 5.42 — CCSDS 121.0-B (« AEC », libaec) : la compression des GRIB d'ECMWF.
* Blocs de J échantillons, une option par bloc (zéros, seconde extension,
* séquences fondamentales + k bits, sans compression), échantillon de
* référence en tête de chaque intervalle (RSI), prédiction + repliement.
*/
function aecInts(b, s, e, d) {
	const n = d.n;
	const nbits = d.nbits;
	const J = d.block;
	const rsiBlocks = d.rsi;
	const flags = d.flags;
	const PREPROCESS = Boolean(flags & 8);
	const RESTRICTED = Boolean(flags & 16);
	const PAD_RSI = Boolean(flags & 32);
	if (Boolean(flags & 1)) throw unsupported("CCSDS signé non pris en charge");
	const out = new Float64Array(n);
	if (nbits === 0) return out;
	const idLen = nbits > 16 ? 5 : nbits > 8 ? 4 : RESTRICTED && nbits <= 4 ? nbits <= 2 ? 1 : 2 : 3;
	const idUncomp = 2 ** idLen - 1;
	const r = new Bits(b, s, e);
	const xmax = 2 ** nbits - 1;
	const rsiSamples = rsiBlocks * J;
	const seBeta = [];
	const seMs = [];
	for (let i = 0, k = 0; i < 13; i++) {
		const ms = k;
		for (let j = 0; j <= i; j++) {
			seBeta[k] = i;
			seMs[k] = ms;
			k++;
		}
	}
	let k = 0;
	let last = 0;
	const raw = new Float64Array(rsiSamples);
	while (k < n) {
		const rsiN = Math.min(rsiSamples, Math.ceil((n - k) / J) * J);
		let got = 0;
		let blocksDone = 0;
		while (got < rsiN) {
			const ref = PREPROCESS && got === 0;
			const id = r.get(idLen);
			if (id === 0) {
				const second = r.get(1);
				if (ref) raw[got++] = r.get(nbits);
				if (second) {
					let c = ref ? 1 : 0;
					while (c < J) {
						const m = r.fs();
						if (m > 90) throw unsupported("CCSDS : seconde extension invalide", "grib-format");
						const d1 = m - seMs[m];
						if ((c & 1) === 0) {
							raw[got++] = seBeta[m] - d1;
							c++;
						}
						raw[got++] = d1;
						c++;
					}
				} else {
					let zb = r.fs() + 1;
					if (zb === 5) zb = Math.min(rsiBlocks - blocksDone, 64 - blocksDone % 64);
					else if (zb > 5) zb--;
					const zs = zb * J - (ref ? 1 : 0);
					for (let q = 0; q < zs; q++) raw[got++] = 0;
					blocksDone += zb - 1;
				}
			} else if (id === idUncomp) for (let q = 0; q < J; q++) raw[got++] = r.get(nbits);
			else {
				const kk = id - 1;
				if (ref) raw[got++] = r.get(nbits);
				const first = got;
				const cnt = J - (ref ? 1 : 0);
				for (let q = 0; q < cnt; q++) raw[got++] = r.fs() * 2 ** kk;
				if (kk) for (let q = 0; q < cnt; q++) raw[first + q] += r.get(kk);
			}
			blocksDone++;
		}
		if (PAD_RSI) r.align();
		const m = Math.min(rsiN, n - k);
		for (let q = 0; q < m; q++) {
			if (!PREPROCESS) {
				out[k + q] = raw[q];
				continue;
			}
			if (q === 0) {
				last = raw[0];
				out[k] = last;
				continue;
			}
			const delta = raw[q];
			const theta = Math.min(last, xmax - last);
			let x;
			if (delta <= 2 * theta) x = delta % 2 === 0 ? last + delta / 2 : last - (delta + 1) / 2;
			else x = theta === last ? delta : xmax - delta;
			last = x;
			out[k + q] = x;
		}
		k += m;
	}
	return out;
}
function parseGrib1(b, start, total, out) {
	let p = start + 8;
	const pdsLen = u24(b, p);
	const table = u8(b, p + 3);
	const center = u8(b, p + 4);
	const process = u8(b, p + 5);
	const flag = u8(b, p + 7);
	const ind = u8(b, p + 8);
	const levType = u8(b, p + 9);
	const level = u16(b, p + 10);
	const yy = u8(b, p + 12);
	const year = ((u8(b, p + 24) || 21) - 1) * 100 + yy;
	const refMs = Date.UTC(year, u8(b, p + 13) - 1, u8(b, p + 14), u8(b, p + 15), u8(b, p + 16));
	const unit = u8(b, p + 17);
	const P1 = u8(b, p + 18);
	const P2 = u8(b, p + 19);
	const tri = u8(b, p + 20);
	const D = s16(b, p + 26);
	const um = UNIT_MS[unit] ?? null;
	const lead = tri === 10 ? P1 << 8 | P2 : [
		2,
		3,
		4,
		5
	].includes(tri) ? P2 : P1;
	const msg = {
		edition: 1,
		center,
		process,
		refMs,
		validMs: um != null ? refMs + lead * um : null,
		table,
		ind,
		packing: "grib1-simple"
	};
	msg.param = param1(table, ind, center);
	msg.level = levType === 105 ? level : levType === 1 ? 0 : null;
	msg.surf = levType;
	p += pdsLen;
	let grid = null;
	let bitmap = null;
	if (flag & 128) {
		const len = u24(b, p);
		const type = u8(b, p + 5);
		if (type !== 0) grid = { unsupported: `grille GRIB1 ${type}` };
		else grid = {
			ni: u16(b, p + 6),
			nj: u16(b, p + 8),
			la1: s24(b, p + 10) / 1e3,
			lo1: s24(b, p + 13) / 1e3,
			la2: s24(b, p + 17) / 1e3,
			lo2: s24(b, p + 20) / 1e3,
			di: u16(b, p + 23) === 65535 ? 0 : u16(b, p + 23) / 1e3,
			dj: u16(b, p + 25) === 65535 ? 0 : u16(b, p + 25) / 1e3,
			scan: u8(b, p + 27)
		};
		p += len;
	} else grid = { unsupported: "grille prédéfinie (sans GDS)" };
	if (flag & 64) {
		const len = u24(b, p);
		if (u16(b, p + 4) !== 0) grid = { unsupported: "bitmap prédéfinie" };
		bitmap = b.subarray(p + 6, p + len);
		p += len;
	}
	const len = u24(b, p);
	const fl = u8(b, p + 3);
	const atTen = msg.param === "swh" || levType === 105 && level === 10 || msg.param === "gust" && (levType === 1 || levType === 105) || center === 98 && levType === 1 && [
		"u",
		"v",
		"gust"
	].includes(msg.param);
	if (!msg.param) msg.skip = "paramètre";
	else if (!atTen) msg.skip = `niveau ${levType}/${level}`;
	else if (!grid || grid.unsupported) msg.skip = grid?.unsupported || "grille";
	else if (fl & 192) msg.skip = fl & 128 ? "harmoniques sphériques" : "compression GRIB1 complexe non prise en charge";
	else {
		const E = s16(b, p + 4);
		const R = ibm32(b, p + 6);
		const nbits = u8(b, p + 10);
		const npts = grid.ni * grid.nj;
		let n = npts;
		if (bitmap) {
			n = 0;
			for (let i = 0; i < npts; i++) if (bitmap[i >> 3] >> 7 - (i & 7) & 1) n++;
		}
		const ints = simpleInts(b, p + 11, p + len, nbits ? Math.min(n, Math.floor(((len - 11) * 8 - (fl & 15)) / nbits)) : n, nbits);
		const scale2 = 2 ** E;
		const dec = 10 ** -D;
		const vals = new Float64Array(n);
		for (let k = 0; k < n; k++) vals[k] = (R + (ints[k] ?? 0) * scale2) * dec;
		const g = regularGrid(grid);
		msg.grid = {
			lats: g.lats,
			lons: g.lons,
			ni: g.ni,
			nj: g.nj
		};
		msg.values = g.reorder(expandBitmap(vals, bitmap, npts));
	}
	out.push(msg);
}
/**
* Tous les champs d'un fichier GRIB (1 ou 2, plusieurs messages à la suite —
* un fichier peut mélanger les deux). Les champs inutiles au routeur sont
* rendus avec `skip` (la raison), sans valeurs.
*/
function parseGrib(bytes) {
	const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const out = [];
	let p = 0;
	let messages = 0;
	while (p + 8 <= b.length) {
		if (!(b[p] === 71 && b[p + 1] === 82 && b[p + 2] === 73 && b[p + 3] === 66)) {
			p++;
			continue;
		}
		const ed = b[p + 7];
		let total;
		if (ed === 2) total = u32(b, p + 8) * 2 ** 32 + u32(b, p + 12);
		else if (ed === 1) total = u24(b, p + 4);
		else {
			p += 4;
			continue;
		}
		if (total < 16 || p + total > b.length) throw Object.assign(/* @__PURE__ */ new Error("GRIB tronqué (fichier incomplet ?)"), { code: "grib-truncated" });
		if (ed === 2) parseGrib2(b, p, total, out);
		else parseGrib1(b, p, total, out);
		messages++;
		p += total;
	}
	delete out.lastBitmap;
	if (!messages) throw Object.assign(/* @__PURE__ */ new Error("ce fichier n'est pas un GRIB"), { code: "grib-format" });
	return out;
}
/** Les unités : le vent en nœuds (GRIB : m/s), les vagues en mètres. */
function toEngineUnits(param, v) {
	if (param === "u" || param === "v" || param === "gust" || param === "ws") return v * KN;
	return v;
}
//#endregion
//#region src/lib/localRouting/gribPack.js
var CENTERS = {
	7: {
		id: "gfs_seamless",
		label: "GFS (NOAA)"
	},
	98: {
		id: "ecmwf_ifs025",
		label: "ECMWF IFS"
	},
	78: {
		id: "icon_seamless",
		label: "ICON (DWD)"
	},
	85: {
		id: "meteofrance_seamless",
		label: "Météo-France"
	},
	74: {
		id: "ukmo_seamless",
		label: "UK Met Office"
	}
};
var centerModel = (c) => CENTERS[c] || {
	id: `grib_c${c}`,
	label: `GRIB (centre ${c})`
};
var fmtRes = (g) => {
	const d = g.lons.length > 1 ? Math.abs(g.lons[1] - g.lons[0]) : 0;
	return `${Math.round(d * 1e3) / 1e3}°`;
};
var sameGrid = (a, b) => a.lats.length === b.lats.length && a.lons.length === b.lons.length && Math.abs(a.lats[0] - b.lats[0]) < 1e-6 && Math.abs(a.lons[0] - b.lons[0]) < 1e-6 && Math.abs(a.lats.at(-1) - b.lats.at(-1)) < 1e-6 && Math.abs(a.lons.at(-1) - b.lons.at(-1)) < 1e-6;
/**
* files = [{ name, bytes }] → { pack, report }.
* Lève `grib-empty` si aucun vent à 10 m utilisable.
*/
function packFromGribFiles(files, { id = null, name = null, nowMs = Date.now() } = {}) {
	const report = {
		files: [],
		models: [],
		waves: null,
		warnings: []
	};
	const fields = [];
	for (const f of files) {
		let msgs;
		try {
			msgs = parseGrib(f.bytes);
		} catch (e) {
			report.files.push({
				name: f.name,
				error: e.message,
				code: e.code || "grib-format"
			});
			continue;
		}
		const skipped = {};
		for (const m of msgs) if (m.skip) {
			const k = m.param ? m.skip : "autres paramètres";
			skipped[k] = (skipped[k] || 0) + 1;
		}
		const used = msgs.filter((m) => !m.skip && m.values && Number.isFinite(m.validMs));
		report.files.push({
			name: f.name,
			bytes: f.bytes.byteLength ?? f.bytes.length,
			edition: [...new Set(msgs.map((m) => m.edition))].join("+"),
			messages: msgs.length,
			used: used.length,
			skipped,
			center: used[0]?.center ?? msgs[0]?.center ?? null,
			runs: [...new Set(used.map((m) => new Date(m.refMs).toISOString()))],
			packings: [...new Set(msgs.map((m) => m.packing).filter(Boolean))]
		});
		for (const m of used) fields.push({
			...m,
			file: f.name
		});
	}
	const byModel = /* @__PURE__ */ new Map();
	for (const m of fields) {
		if (m.param === "swh") continue;
		const k = centerModel(m.center).id;
		if (!byModel.has(k)) byModel.set(k, []);
		byModel.get(k).push(m);
	}
	const grids = {};
	const labels = {};
	for (const [model, list] of byModel) {
		const run = Math.max(...list.map((m) => m.refMs));
		const older = list.filter((m) => m.refMs !== run).length;
		if (older) report.warnings.push({
			code: "olderRun",
			model,
			count: older
		});
		const cur = list.filter((m) => m.refMs === run);
		const ref = cur.find((m) => m.param === "u") || cur.find((m) => m.param === "ws");
		if (!ref) {
			report.warnings.push({
				code: "noWind",
				model
			});
			continue;
		}
		const g0 = ref.grid;
		const at = /* @__PURE__ */ new Map();
		for (const m of cur) {
			if (!sameGrid(m.grid, g0)) {
				report.warnings.push({
					code: "otherGrid",
					model,
					param: m.param
				});
				continue;
			}
			if (!at.has(m.validMs)) at.set(m.validMs, {});
			at.get(m.validMs)[m.param] = m.values;
		}
		const times = [...at.keys()].filter((t) => {
			const x = at.get(t);
			return x.u && x.v || x.ws && x.wd;
		}).sort((a, b) => a - b);
		if (!times.length) {
			report.warnings.push({
				code: "noWind",
				model
			});
			continue;
		}
		const I = g0.lats.length;
		const J = g0.lons.length;
		const T = times.length;
		const N = I * J;
		const u = new Float64Array(T * N);
		const v = new Float64Array(T * N);
		const hasGust = times.every((t) => at.get(t).gust);
		const gust = hasGust ? new Float64Array(T * N) : null;
		times.forEach((t, k) => {
			const x = at.get(t);
			for (let q = 0; q < N; q++) {
				let uu;
				let vv;
				if (x.u && x.v) {
					uu = toEngineUnits("u", x.u[q]);
					vv = toEngineUnits("v", x.v[q]);
				} else {
					const ws = toEngineUnits("ws", x.ws[q]);
					const a = (x.wd[q] + 180) * Math.PI / 180;
					uu = ws * Math.sin(a);
					vv = ws * Math.cos(a);
				}
				u[k * N + q] = uu;
				v[k * N + q] = vv;
				if (gust) gust[k * N + q] = toEngineUnits("gust", x.gust[q]);
			}
		});
		if (!hasGust) report.warnings.push({
			code: "noGust",
			model
		});
		grids[model] = {
			model,
			lats: g0.lats.slice(),
			lons: g0.lons.slice(),
			times: Float64Array.from(times),
			u,
			v,
			gust,
			fetchedAt: new Date(run).toISOString()
		};
		labels[model] = `${centerModel(ref.center).label} · GRIB ${fmtRes(g0)}`;
		report.models.push({
			id: model,
			label: labels[model],
			run: new Date(run).toISOString(),
			fromMs: times[0],
			toMs: times[T - 1],
			steps: T,
			res: fmtRes(g0),
			gust: hasGust,
			bbox: [
				g0.lons[0],
				g0.lats[0],
				g0.lons[J - 1],
				g0.lats[I - 1]
			]
		});
	}
	if (!Object.keys(grids).length) throw Object.assign(/* @__PURE__ */ new Error("aucun vent à 10 m utilisable dans ce GRIB"), {
		code: "grib-empty",
		report
	});
	let waves = null;
	const sw = fields.filter((m) => m.param === "swh");
	if (sw.length) {
		const run = Math.max(...sw.map((m) => m.refMs));
		const cur = sw.filter((m) => m.refMs === run);
		const g0 = cur[0].grid;
		const byT = /* @__PURE__ */ new Map();
		for (const m of cur) if (sameGrid(m.grid, g0)) byT.set(m.validMs, m.values);
		const times = [...byT.keys()].sort((a, b) => a - b);
		const N = g0.lats.length * g0.lons.length;
		const hs = new Float64Array(times.length * N);
		times.forEach((t, k) => hs.set(byT.get(t), k * N));
		waves = {
			lats: g0.lats.slice(),
			lons: g0.lons.slice(),
			times: Float64Array.from(times),
			hs,
			fetchedAt: new Date(run).toISOString()
		};
		report.waves = {
			run: new Date(run).toISOString(),
			steps: times.length,
			res: fmtRes(g0),
			center: cur[0].center
		};
	} else report.warnings.push({ code: "noWaves" });
	const all = Object.values(grids);
	const bbox = [
		Math.min(...all.map((g) => g.lons[0])),
		Math.min(...all.map((g) => g.lats[0])),
		Math.max(...all.map((g) => g.lons.at(-1))),
		Math.max(...all.map((g) => g.lats.at(-1)))
	];
	const pack = {
		v: 1,
		id: id || `grib-${nowMs.toString(36)}`,
		kind: "grib",
		name: name || files.map((f) => f.name).join(", ").slice(0, 80),
		createdAt: new Date(nowMs).toISOString(),
		bbox,
		models: Object.keys(grids),
		labels,
		grids,
		waves,
		source: {
			kind: "grib",
			files: report.files.map(({ name: n, edition, center, runs, packings, bytes }) => ({
				name: n,
				edition,
				center,
				runs,
				packings,
				bytes
			}))
		}
	};
	pack.bytes = packBytes(pack);
	return {
		pack,
		report
	};
}
//#endregion
//#region src/lib/localRouting/localRuns.js
var ENVELOPE_KIND = "wangap-route-run";
//#endregion
//#region scripts/routing/localStore.mjs
var CHARTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "routing", "charts", "v1");
/** Les tuiles d'un dossier (index.json, t_*.wgt en gzip, tss.json). */
function fileChartStore(dir = CHARTS_DIR) {
	return {
		index: async () => JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")),
		tile: async (key, meta) => {
			const f = path.join(dir, meta?.file || `t_${key}.wgt`);
			if (!fs.existsSync(f)) throw Object.assign(/* @__PURE__ */ new Error(`tuile absente : ${key}`), { code: "no-charts" });
			return new Uint8Array(zlib.gunzipSync(fs.readFileSync(f)));
		},
		tss: async (meta) => JSON.parse(fs.readFileSync(path.join(dir, meta?.file || "tss.json"), "utf8"))
	};
}
/** Un paquet à partir de grilles au format du moteur ({ modèle: grille }, vagues). */
function packFromGrids({ grids, waves = null, bbox, days = 10, kind = "open-meteo", name = null, labels = {}, source = null, id = null }) {
	const pack = {
		v: 1,
		id: id || `pack-${Date.now().toString(36)}`,
		kind,
		name,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		bbox,
		days,
		models: Object.keys(grids),
		labels,
		grids: Object.fromEntries(Object.entries(grids).map(([m, g]) => [m, compactWind({
			...g,
			model: m
		})])),
		waves: compactWaves(waves),
		source
	};
	pack.bytes = packBytes(pack);
	return pack;
}
var unF64 = (o) => {
	if (!o) return null;
	const b = Buffer.from(o.f64, "base64");
	return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
function packFromJson(text) {
	const p = JSON.parse(text);
	const dec = (c) => c ? Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v && typeof v === "object" && "f64" in v ? unF64(v) : v])) : null;
	return {
		...p,
		grids: Object.fromEntries(Object.entries(p.grids || {}).map(([m, c]) => [m, dec(c)])),
		waves: dec(p.waves)
	};
}
var readPackFile = (f) => packFromJson(zlibMaybe(fs.readFileSync(f)));
function zlibMaybe(buf) {
	return buf[0] === 31 && buf[1] === 139 ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}
//#endregion
//#region scripts/routing/lib/chain.mjs
/** stops : [départ, porte…, arrivée] ; opts : ceux de route(), sans start / dest / departMs. */
function routeChain(stops, departMs, opts) {
	let t = departMs;
	const legs = [];
	for (let i = 0; i < stops.length - 1; i++) {
		const maxHours = Math.min(opts.maxHours ?? 168, opts.horizonMs ? Math.floor((opts.horizonMs - t) / 36e5) - 1 : Infinity);
		if (maxHours < 1) return {
			ok: false,
			short: true,
			reason: `prévision trop courte pour la jambe ${i + 1}`
		};
		const coastFree = Boolean(stops[i].strait && stops[i].strait === stops[i + 1].strait);
		const r = route({
			...opts,
			start: stops[i],
			dest: stops[i + 1],
			departMs: t,
			voyageStartMs: departMs,
			maxHours,
			coastFree
		});
		if (!r.ok) return {
			...r,
			reason: stops.length > 2 ? `jambe ${i + 1} (${stops[i + 1].name || "arrivée"}) : ${r.reason}` : r.reason
		};
		legs.push(r);
		t = r.arrivalMs;
	}
	if (legs.length === 1) return legs[0];
	const points = legs.flatMap((r, i) => i === 0 ? r.points : r.points.slice(1));
	const sum = (k) => legs.reduce((s, r) => s + r.stats[k], 0);
	const max = (k) => legs.some((r) => r.stats[k] != null) ? Math.max(...legs.map((r) => r.stats[k] ?? 0)) : null;
	const hours = (t - departMs) / 36e5;
	const distanceNm = legs.reduce((s, r) => s + r.distanceNm, 0);
	return {
		ok: true,
		arrivalMs: t,
		hours,
		distanceNm,
		points,
		legs: legs.length,
		via: stops.slice(1, -1).map((s) => s.name),
		stats: {
			avgKn: distanceNm / hours,
			motorH: sum("motorH"),
			upwindH: sum("upwindH"),
			reachH: sum("reachH"),
			downH: sum("downH"),
			maxTws: max("maxTws"),
			maxGust: max("maxGust"),
			maxWave: max("maxWave")
		}
	};
}
//#endregion
//#region scripts/routing/lib/routeWorker.mjs
/**
* Les données d'un fil → la fonction qui calcule un message `{ model, stops, departMs, limits? }`.
* D29 bis — `limits` dans le message : une autre hypothèse (la sensibilité à la polaire, à l'équipage)
* sur le MÊME fil (les cartes et la météo déjà là) ; sans elle, celles du fil, comme avant.
*/
function routeThread(D) {
	const land = maskFromGrid(D.land);
	const coast = D.coast ? maskFromGrid(D.coast) : null;
	const forbiddenMask = D.forbiddenMask ? maskFromGrid(D.forbiddenMask) : null;
	const coastIndex = D.coastIndex ? indexFromData(D.coastIndex) : null;
	return ({ model, stops, departMs, limits = null }) => {
		const g = D.grids[model];
		return routeChain(stops, departMs, {
			polar: D.polar,
			wind: (la, lo, t) => windAt(g, la, lo, t),
			wave: (la, lo, t) => waveAt(D.waves, la, lo, t),
			land,
			coast,
			forbidden: D.forbidden,
			forbiddenMask,
			coastIndex,
			limits: limits || D.limits,
			maxHours: 400,
			horizonMs: g.times[g.times.length - 1]
		});
	};
}
if (parentPort && workerData && workerData.__thread !== "graph") {
	const run = routeThread(workerData);
	parentPort.on("message", ({ id, ...msg }) => {
		try {
			parentPort.postMessage({
				id,
				r: run(msg)
			});
		} catch (e) {
			parentPort.postMessage({
				id,
				error: e.message
			});
		}
	});
}
//#endregion
//#region scripts/routing/lib/graphWorker.mjs
/** Les données d'un fil → la fonction qui calcule un message `{ model, stops, departMs, profile, order, options }`. */
function graphThread(D) {
	const land = maskFromGrid(D.land);
	const coast = D.coast ? maskFromGrid(D.coast) : null;
	const forbiddenMask = D.forbiddenMask ? maskFromGrid(D.forbiddenMask) : null;
	const coastIndex = D.coastIndex ? indexFromData(D.coastIndex) : null;
	const charts = {
		land,
		coast,
		forbidden: D.forbidden,
		forbiddenMask,
		coastIndex,
		bbox: D.bbox,
		limits: D.limits
	};
	const prepared = /* @__PURE__ */ new Map();
	return ({ model, stops, departMs, profile, order, options = {} }) => {
		const t0 = Date.now();
		const g = D.grids[model];
		const key = JSON.stringify([stops, options.spacingNm ?? null]);
		if (!prepared.has(key)) prepared.set(key, prepareLegs(stops, {
			...charts,
			spacingNm: options.spacingNm ?? null
		}));
		const sg = (options.spreadModels || []).map((m) => D.grids[m]).filter(Boolean);
		const spread = sg.length > 1 ? (la, lo, t) => {
			const v = sg.map((x) => windAt(x, la, lo, t)?.tws).filter((x) => x != null);
			return v.length > 1 ? Math.max(...v) - Math.min(...v) : 0;
		} : null;
		return {
			...optimise({
				...charts,
				...options,
				spread,
				stops,
				departMs,
				profile,
				order,
				polar: D.polar,
				prepared: prepared.get(key),
				wind: (la, lo, t) => windAt(g, la, lo, t),
				wave: D.waves ? (la, lo, t) => waveAt(D.waves, la, lo, t) : null,
				maxHours: options.maxHours ?? 400,
				horizonMs: g.times[g.times.length - 1]
			}),
			wallMs: Date.now() - t0,
			heapMB: Math.round(process.memoryUsage().heapUsed / 1e6)
		};
	};
}
if (parentPort && workerData && workerData.__thread !== "route") {
	const run = graphThread(workerData);
	parentPort.on("message", ({ id, ...msg }) => {
		try {
			parentPort.postMessage({
				id,
				r: run(msg)
			});
		} catch (e) {
			parentPort.postMessage({
				id,
				error: e.message
			});
		}
	});
}
//#endregion
//#region src/lib/localRouting/browserPool.js
/**
* Quel fil du moteur ? Le nom du fichier quand l'adresse le garde ; mais Vite
* remplace un petit fichier `new URL('./x.mjs', import.meta.url)` par une
* adresse `data:` (son texte en base64) — alors la forme de `workerData` : les
* groupes de l'optimiseur (graphWorker) reçoivent l'emprise `bbox`, ceux des
* isochrones (routeWorker) jamais (advisor, optimiser, departures — vérifié par
* verify-routing-local).
*/
function poolKind(file, workerData) {
	const s = String(file?.href || file || "");
	if (/graphWorker/.test(s)) return "graph";
	if (/routeWorker/.test(s)) return "route";
	return workerData && Object.prototype.hasOwnProperty.call(workerData, "bbox") ? "graph" : "route";
}
//#endregion
//#region src/lib/localRouting/inProcessPool.js
function createInProcessPool(file, workerData) {
	const run = poolKind(file, workerData) === "graph" ? graphThread(workerData) : routeThread(workerData);
	let chain = Promise.resolve();
	return {
		size: 1,
		run: (msg) => {
			const p = chain.then(() => new Promise((ok, ko) => {
				setTimeout(() => {
					try {
						ok(run(msg));
					} catch (e) {
						ko(new Error(e?.message || String(e)));
					}
				}, 0);
			}));
			chain = p.catch(() => {});
			return p;
		},
		close: async () => {}
	};
}
var polar_wangap_default = {
	TWS_BINS: [
		4,
		6,
		8,
		10,
		12,
		14,
		16,
		20,
		25,
		30
	],
	TWA_BINS: [
		40,
		50,
		60,
		75,
		90,
		110,
		120,
		135,
		150,
		165,
		180
	],
	reference: [
		[
			1.8,
			2.6,
			3.2,
			3.6,
			3.8,
			3.8,
			3.7,
			3.4,
			3,
			2.6,
			2.3
		],
		[
			2.8,
			3.9,
			4.7,
			5.3,
			5.6,
			5.6,
			5.5,
			5.1,
			4.5,
			3.9,
			3.5
		],
		[
			3.6,
			5,
			6,
			6.8,
			7.2,
			7.3,
			7.1,
			6.6,
			5.9,
			5.1,
			4.6
		],
		[
			4.2,
			5.8,
			7,
			7.9,
			8.4,
			8.6,
			8.4,
			7.9,
			7.1,
			6.2,
			5.6
		],
		[
			4.6,
			6.4,
			7.7,
			8.7,
			9.3,
			9.6,
			9.5,
			9,
			8.2,
			7.2,
			6.5
		],
		[
			4.9,
			6.8,
			8.2,
			9.3,
			10,
			10.4,
			10.4,
			10,
			9.2,
			8.1,
			7.4
		],
		[
			5.1,
			7.1,
			8.5,
			9.7,
			10.5,
			11,
			11.1,
			10.8,
			10.1,
			9,
			8.2
		],
		[
			5.2,
			7.3,
			8.8,
			10.1,
			11,
			11.7,
			11.9,
			11.8,
			11.3,
			10.3,
			9.4
		],
		[
			5,
			7.1,
			8.7,
			10.1,
			11.1,
			12,
			12.4,
			12.5,
			12.2,
			11.3,
			10.4
		],
		[
			4.6,
			6.6,
			8.2,
			9.7,
			10.8,
			11.8,
			12.3,
			12.6,
			12.4,
			11.6,
			10.8
		]
	],
	bySail: /* @__PURE__ */ JSON.parse("{\"haute+gennaker\":{\"table\":[[1.8,2.6,3.2,3.6,3.8,3.8,3.7,3.4,3,2.6,2.3],[2.8,3.9,4.7,5.3,4.5,5.6,5.5,5.1,4.5,3.9,3.5],[3.6,5,6,6.8,5.42,5.98,6.13,5.25,4.54,5.1,4.6],[4.2,5.8,7,7.9,8.4,8.15,8.4,5.74,5.3,6.2,5.6],[4.6,6.4,7.7,8.7,9.3,9.6,9.5,6.5,6.1,7.2,6.5],[4.9,6.8,8.2,9.3,10,10.4,10.4,10,9.2,8.1,7.4],[5.1,7.1,8.5,9.7,10.5,11,11.1,10.8,10.1,9,8.2],[5.2,7.3,8.8,10.1,11,11.7,11.9,11.8,11.3,10.3,9.4],[5,7.1,8.7,10.1,11.1,12,12.4,12.5,12.2,11.3,10.4],[4.6,6.6,8.2,9.7,10.8,11.8,12.3,12.6,12.4,11.6,10.8]],\"weight\":718,\"learnedCells\":11,\"weights\":[[0,0,0.5,2.2,2.4,1.7,1.2,0.7,0.3,0.4,0.2],[0.8,0.9,2.4,9.3,20.2,11.5,14.4,13.4,8,3.6,2.4],[1,1.8,1.6,4.3,21.3,32,25.9,94.8,49,7.9,2.4],[0.5,0.4,0.9,3.5,16.9,25.4,12.7,73.3,66.6,2.9,0.4],[0,0.5,0,0.4,2.9,13.1,9.6,25.8,52.4,2.7,1.3],[0.4,0.4,0,0.3,0.4,9,15.6,10.2,18.3,1.3,0.6],[0,0,0,0.5,0,0.2,2.6,2.9,3.6,1.1,0],[0,0,0,0,0,0,0,0,0.4,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0]],\"counts\":[[0,0,1,5,8,5,4,3,1,2,1],[2,2,7,23,47,29,39,38,20,11,7],[2,4,4,9,54,73,67,179,93,22,6],[1,1,2,10,40,63,44,135,106,12,1],[0,2,0,1,11,35,40,101,137,12,4],[1,1,0,1,1,18,41,46,80,6,2],[0,0,0,2,0,1,7,13,17,5,0],[0,0,0,0,0,0,0,0,2,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0]],\"raw\":[[null,null,3.43,3.88,3.38,3.3,2.7,3.25,3,3.68,2.38],[1.53,4.22,4.3,4.6,4.5,4.58,4.7,4.5,3.9,4.75,4.68],[4.27,4.53,4.85,6.45,5.42,5.98,6.13,5.25,4.54,4,4.35],[2.53,3.63,4.68,7.2,6.62,8.15,7.82,5.74,5.3,5.3,1.85],[null,3.79,null,7.7,8.66,9.5,9.31,6.5,6.1,6.28,5.63],[0.9,0.63,null,1.33,1.28,10.25,9.92,7.79,6.71,6.28,5.84],[null,null,null,10.58,null,4.44,10.13,8.22,7.68,6.49,null],[null,null,null,null,null,null,null,null,8.12,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null]],\"estimatedShare\":[[null,null,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,0.63,0.75,1,1],[1,1,1,1,1,1,1,0.38,0.37,1,1],[1,1,1,1,1,1,0.92,0.29,0.19,1,1],[null,1,null,1,1,1,1,0.85,0.49,1,1],[1,1,null,1,1,1,1,1,1,1,1],[null,null,null,1,null,1,1,1,1,1,null],[null,null,null,null,null,null,null,null,1,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null]]},\"haute+genois\":{\"table\":[[1.8,2.6,3.2,3.6,3.8,3.8,3.7,3.4,3,2.6,2.3],[2.8,3.9,4.65,4.55,5.6,5.6,5.5,5.1,4.5,3.9,3.5],[3.6,5.93,5.7,5.88,7.2,7.3,7.1,6.6,5.9,5.1,4.6],[4.2,6.73,6.93,6.73,8.4,8.6,8.4,7.9,4.76,6.2,5.6],[4.6,7.13,7.78,8.22,9.3,9.6,9.5,9,5.41,7.2,6.5],[4.9,7.6,8.4,8.85,10,10.4,10.4,8.12,6.13,8.1,7.4],[5.1,8.48,8.87,9.7,10.5,11,10.6,9.31,7.9,9,5.73],[5.2,7.3,8.8,10.1,11,11.7,11.9,10.23,8.66,10.3,9.4],[5,7.1,8.7,10.1,11.1,12,12.4,12.5,12.2,11.3,10.4],[4.6,6.6,8.2,9.7,10.8,11.8,12.3,12.6,12.4,11.6,10.8]],\"weight\":2082,\"learnedCells\":27,\"weights\":[[0.5,7.1,24,19.2,3.2,0.8,0,0,0.2,0.4,0],[0.5,7.9,64.8,51.4,4.8,2.2,0.9,1.1,5.9,7.4,3.7],[2.6,26.2,137.8,56,9.6,8.2,4.3,4.2,11,15.3,11],[2.5,39.6,225.9,87.8,11.3,9.6,11.3,13.9,26.2,8,1.9],[8.5,63.6,179.6,50.7,9.6,10.4,11,17.8,22.3,4.5,0.8],[16.1,115.3,158,28.3,6.7,8.3,16.6,20.1,23,2.2,11.5],[3,43.6,67.7,9.3,5.2,7.8,38.8,32.8,25.8,7.2,32.5],[2.1,4,5.9,0.5,2.9,2.8,14.4,20.6,23.4,10.7,3.4],[0,0,0,0,0.5,0,0.2,0.2,0.8,0.4,0],[0,0,0,0,0,0,0,0,0,0,0]],\"counts\":[[1,14,46,38,6,2,0,0,1,2,0],[2,20,130,105,13,8,4,5,26,35,17],[10,61,294,124,30,23,14,19,45,71,46],[8,95,481,184,41,31,30,49,85,37,9],[23,142,391,118,32,32,44,72,76,18,2],[33,235,329,63,17,23,64,94,68,8,22],[9,94,151,31,14,18,103,157,102,16,60],[5,16,16,2,8,7,35,97,110,26,8],[0,0,0,0,1,0,1,1,4,2,0],[0,0,0,0,0,0,0,0,0,0,0]],\"raw\":[[2.28,2.48,3.2,3.15,2.73,2.91,null,null,3.9,4.11,null],[4.54,3.14,4.65,4.55,3.95,4.07,5.31,4.85,4.98,5.09,4.93],[4.78,5.93,5.7,5.88,6.17,5.83,4.63,4.33,5.16,5.52,5.74],[5.63,6.73,6.93,6.73,6.85,6.3,5.3,5.09,4.76,5.36,6.28],[5.83,7.13,7.78,8.22,7.75,8.12,8.44,6.96,5.41,5.09,4.65],[6.68,7.6,8.4,8.85,8.1,8.76,8.87,8.12,6.13,5.41,5.35],[6.88,8.48,8.87,10,10.6,10.05,10.6,9.31,7.9,6.93,5.73],[8.35,8.22,9.5,8.22,11.02,9.93,9.41,10.23,8.66,8.55,6.23],[null,null,null,null,2.1,null,9.95,10.82,9.31,9.09,null],[null,null,null,null,null,null,null,null,null,null,null]],\"estimatedShare\":[[1,1,1,1,1,1,null,null,1,1,null],[1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1,1,1,1],[null,null,null,null,1,null,1,1,1,1,null],[null,null,null,null,null,null,null,null,null,null,null]]},\"haute+spi\":{\"table\":[[1.8,2.6,3.2,3.6,3.8,3.8,3.7,3.4,3,2.6,2.3],[2.8,3.9,4.7,5.3,5.6,5.6,5.5,5.1,4.5,3.9,3.5],[3.6,5,6,6.8,7.2,7.3,7.1,6.6,5.9,5.1,4.6],[4.2,5.8,7,7.9,8.4,8.6,8.4,7.9,7.1,6.2,5.6],[4.6,6.4,7.7,8.7,9.3,9.6,9.5,9,5.95,7.2,6.5],[4.9,6.8,8.2,9.3,10,10.4,10.4,10,6.93,6.78,7.4],[5.1,7.1,8.5,9.7,10.5,11,11.1,10.8,7.9,7.36,6.6],[5.2,7.3,8.8,10.1,11,11.7,11.9,11.8,11.3,10.3,9.4],[5,7.1,8.7,10.1,11.1,12,12.4,12.5,12.2,11.3,10.4],[4.6,6.6,8.2,9.7,10.8,11.8,12.3,12.6,12.4,11.6,10.8]],\"weight\":244,\"learnedCells\":6,\"weights\":[[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0.4,0.2],[0,0,0,0,0,0,0,0,6.8,7.7,1.2],[0,0,0,0,0,0,0,1,20.6,18.4,0.8],[0,0,0,0,0,0,0.3,1.1,27.4,24.1,9.6],[0,0,0,0.3,0,0,0,1.6,29.7,24.6,56.8],[0,0,0,0,0,0,0,0,7.5,3.7,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0]],\"counts\":[[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,2,1],[0,0,0,0,0,0,0,0,29,32,5],[0,0,0,0,0,0,0,4,89,68,3],[0,0,0,0,0,0,1,5,124,70,21],[0,0,0,1,0,0,0,6,131,77,106],[0,0,0,0,0,0,0,0,31,17,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0]],\"raw\":[[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,5.3,3.03],[null,null,null,null,null,null,null,null,5.41,5.52,4.87],[null,null,null,null,null,null,null,7.25,5.95,5.84,6.38],[null,null,null,null,null,null,4.52,6.93,6.93,6.78,6.73],[null,null,null,10.11,null,null,null,10.14,7.9,7.36,6.6],[null,null,null,null,null,null,null,null,9.67,10.93,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null]],\"estimatedShare\":[[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,1,1],[null,null,null,null,null,null,null,null,1,1,1],[null,null,null,null,null,null,null,1,1,1,1],[null,null,null,null,null,null,1,1,1,1,1],[null,null,null,1,null,null,null,1,1,1,1],[null,null,null,null,null,null,null,null,1,1,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null]]},\"ris1+genois\":{\"table\":[[1.8,2.6,3.2,3.6,3.8,3.8,3.7,3.4,3,2.6,2.3],[2.8,3.9,4.7,5.3,5.6,5.6,5.5,5.1,4.5,3.9,3.5],[3.6,5,6,6.8,7.2,7.3,7.1,6.6,5.9,5.1,4.6],[4.2,5.8,7,7.9,8.4,8.6,8.4,7.9,7.1,6.2,5.6],[4.6,6.4,7.7,8.7,9.3,9.6,9.5,9,8.2,7.2,6.5],[4.9,6.8,8.2,9.3,10,10.4,10.4,10,9.2,8.1,7.4],[5.1,7.1,8.5,9.7,10.5,11,11.1,10.8,10.1,9,8.2],[5.2,7.3,8.8,10.1,11,11.7,11.9,11.8,11.3,10.3,9.4],[5,7.1,8.7,10.1,11.1,12,12.4,12.5,12.2,11.3,10.4],[4.6,6.6,8.2,9.7,10.8,11.8,12.3,12.6,12.4,11.6,10.8]],\"weight\":12,\"learnedCells\":0,\"weights\":[[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,6.2,0.3,0],[0,0,0,0,0,0,0,0,5.4,0.3,0.3],[0,0,0,0,0,0,0,0,0,0,0]],\"counts\":[[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,22,1,0],[0,0,0,0,0,0,0,0,19,1,1],[0,0,0,0,0,0,0,0,0,0,0]],\"raw\":[[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,8.37,7.89,null],[null,null,null,null,null,null,null,null,9.32,8.56,8.92],[null,null,null,null,null,null,null,null,null,null,null]],\"estimatedShare\":[[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,1,1,null],[null,null,null,null,null,null,null,null,1,1,1],[null,null,null,null,null,null,null,null,null,null,null]]},\"ris1+trinquette\":{\"table\":[[1.8,2.6,3.2,3.6,3.8,3.8,3.7,3.4,3,2.6,2.3],[2.8,3.9,4.7,5.3,5.6,5.6,5.5,5.1,4.5,3.9,3.5],[3.6,5,6,6.8,7.2,7.3,7.1,6.6,5.9,5.1,4.6],[4.2,5.8,7,7.9,8.4,8.6,8.4,7.9,7.1,6.2,5.6],[4.6,6.4,7.7,8.7,9.3,9.6,9.5,9,8.2,7.2,6.5],[4.9,6.8,8.2,9.3,10,10.4,10.4,10,9.2,8.1,7.4],[5.1,7.1,8.5,9.7,10.5,11,11.1,10.8,10.1,9,8.2],[5.2,7.3,8.8,10.1,11,11.7,11.9,11.8,11.3,10.3,9.4],[5,7.1,8.7,10.1,11.1,12,12.4,12.5,12.2,11.3,10.4],[4.6,6.6,8.2,9.7,10.8,11.8,12.3,12.6,12.4,11.6,10.8]],\"weight\":34,\"learnedCells\":0,\"weights\":[[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0.5,0,0,0,0,0,0,0,0,0],[0.5,1.2,2.1,0.2,0,0,0,0,0,0,0],[2.8,10.6,9.2,0.7,0.2,0,0,0,0,0,0],[0.5,0.7,2.3,0.5,0,0,0,0.3,0.8,0,0],[0.5,0.5,0,0,0,0,0,0,0,0,0]],\"counts\":[[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,2,0,0,0,0,0,0,0,0,0],[2,5,9,1,0,0,0,0,0,0,0],[12,45,39,3,1,0,0,0,0,0,0],[2,3,10,2,0,0,0,1,3,0,0],[2,2,0,0,0,0,0,0,0,0,0]],\"raw\":[[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,7.25,null,null,null,null,null,null,null,null,null],[6.71,9.74,9.2,8.33,null,null,null,null,null,null,null],[8.55,9.31,9.52,9.41,8.12,null,null,null,null,null,null],[6.71,9.41,10.71,8.76,null,null,null,10.03,9.95,null,null],[6.82,8.66,null,null,null,null,null,null,null,null,null]],\"estimatedShare\":[[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,1,null,null,null,null,null,null,null,null,null],[1,1,1,1,null,null,null,null,null,null,null],[1,1,1,1,1,null,null,null,null,null,null],[1,1,1,1,null,null,null,1,1,null,null],[1,1,null,null,null,null,null,null,null,null,null]]},\"haute+trinquette\":{\"table\":[[1.8,2.6,3.2,3.6,3.8,3.8,3.7,3.4,3,2.6,2.3],[2.8,3.9,4.7,5.3,5.6,5.6,5.5,5.1,4.5,3.9,3.5],[3.6,5,6,6.8,7.2,7.3,7.1,6.6,5.9,5.1,4.6],[4.2,5.8,7,7.9,8.4,8.6,8.4,7.9,7.1,6.2,5.6],[4.6,6.4,7.7,8.7,9.3,9.6,9.5,9,8.2,7.2,6.5],[4.9,6.8,8.2,9.3,10,10.4,10.4,10,9.2,8.1,7.4],[5.1,7.1,8.5,9.7,10.5,11,11.1,10.8,10.1,9,8.2],[5.2,7.3,8.8,10.1,11,11.7,11.9,11.8,11.3,10.3,9.4],[5,7.1,8.7,10.1,11.1,12,12.4,12.5,12.2,11.3,10.4],[4.6,6.6,8.2,9.7,10.8,11.8,12.3,12.6,12.4,11.6,10.8]],\"weight\":17,\"learnedCells\":0,\"weights\":[[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[3.6,13.1,0.5,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0]],\"counts\":[[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[7,25,1,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0]],\"raw\":[[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[7.32,8.82,9.58,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null]],\"estimatedShare\":[[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[1,1,1,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null]]},\"ris2+trinquette\":{\"table\":[[1.8,2.6,3.2,3.6,3.8,3.8,3.7,3.4,3,2.6,2.3],[2.8,3.9,4.7,5.3,5.6,5.6,5.5,5.1,4.5,3.9,3.5],[3.6,5,6,6.8,7.2,7.3,7.1,6.6,5.9,5.1,4.6],[4.2,5.8,7,7.9,8.4,8.6,8.4,7.9,7.1,6.2,5.6],[4.6,6.4,7.7,8.7,9.3,9.6,9.5,9,8.2,7.2,6.5],[4.9,6.8,8.2,9.3,10,10.4,10.4,10,9.2,8.1,7.4],[5.1,7.1,8.5,9.7,10.5,11,11.1,10.8,10.1,9,8.2],[5.2,7.3,8.8,10.1,11,11.7,11.9,11.8,11.3,10.3,9.4],[5,7.1,8.7,10.1,11.1,12,12.4,12.5,12.2,11.3,10.4],[4.6,6.6,8.2,9.7,10.8,11.8,12.3,12.6,12.4,11.6,10.8]],\"weight\":10,\"learnedCells\":0,\"weights\":[[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0.2,0.2,0,0,0,0,0,0,0,0],[0,0,0.2,0.2,0,0,0,0,0,0,0],[0,0.5,0.5,0,0,0,0,0,0,0,0],[0.2,0.7,1.4,0.7,0.2,0.7,0,0,0,0,0],[0,0.2,0.9,0.9,0,0,0,0.7,0,0,0],[0,0,0.7,0.7,0.2,0,0,0.2,0,0,0]],\"counts\":[[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0],[0,1,1,0,0,0,0,0,0,0,0],[0,0,1,1,0,0,0,0,0,0,0],[0,2,2,0,0,0,0,0,0,0,0],[1,3,6,3,1,3,0,0,0,0,0],[0,1,4,4,0,0,0,3,0,0,0],[0,0,3,3,1,0,0,1,0,0,0]],\"raw\":[[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,4.33,3.68,null,null,null,null,null,null,null,null],[null,null,2.6,3.03,null,null,null,null,null,null,null],[null,6.38,6.17,null,null,null,null,null,null,null,null],[2.92,9.52,9.74,12.88,10.6,8.87,null,null,null,null,null],[null,10.17,8.55,10.5,null,null,null,11.04,null,null,null],[null,null,11.04,7.57,11.79,null,null,9.85,null,null,null]],\"estimatedShare\":[[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null,null,null,null],[null,1,1,null,null,null,null,null,null,null,null],[null,null,1,1,null,null,null,null,null,null,null],[null,1,1,null,null,null,null,null,null,null,null],[1,1,1,1,1,1,null,null,null,null,null],[null,1,1,1,null,null,null,1,null,null,null],[null,null,1,1,1,null,null,1,null,null,null]]}}"),
	builtAt: "2026-10-28T19:11:04.919Z",
	rows: 8581,
	excluded: {
		"horsPlage": 3705,
		"moteur": 1521,
		"moteurPetitTemps": 511,
		"moteurAuPres": 97
	},
	halfLifeDays: 60,
	mixed: {
		"table": [
			[
				2.17,
				2.47,
				3.23,
				3.18,
				2.77,
				2.91,
				2.93,
				2.62,
				2.19,
				1.86,
				1.75
			],
			[
				3.26,
				3.88,
				4.65,
				4.55,
				4.95,
				4.34,
				4.76,
				4.43,
				4.13,
				3.82,
				2.82
			],
			[
				4.34,
				5.78,
				5.68,
				5.88,
				5.46,
				5.98,
				5.95,
				5.2,
				4.83,
				5.3,
				4.39
			],
			[
				5.52,
				6.73,
				6.93,
				6.73,
				6.8,
				8.07,
				6.79,
				5.6,
				5.19,
				5.37,
				4.43
			],
			[
				5.77,
				7.13,
				7.78,
				8.2,
				7.92,
				9.28,
				8.99,
				6.65,
				5.84,
				5.71,
				5.35
			],
			[
				6.47,
				7.6,
				8.4,
				8.85,
				8.35,
				9.83,
				9.81,
				7.91,
				6.71,
				6.49,
				6.27
			],
			[
				6.69,
				8.6,
				9,
				9.6,
				8.98,
				10.49,
				10.45,
				9.31,
				7.9,
				7.14,
				6.35
			],
			[
				6.69,
				8.77,
				9.51,
				9.6,
				8.98,
				10.49,
				10.45,
				10.09,
				8.87,
				8.54,
				7.04
			],
			[
				6.26,
				8.38,
				9.64,
				8.89,
				8.78,
				9.65,
				10,
				9.97,
				9.67,
				8.73,
				8.24
			],
			[
				5.76,
				7.71,
				8.87,
				8.18,
				8.08,
				8.89,
				9.2,
				10.18,
				9.8,
				9.06,
				8.47
			]
		],
		"weight": 12450,
		"learnedCells": 74,
		"measuredCells": 41,
		"blendedCells": 33,
		"escaleCells": 36
	},
	learned: {
		"table": [
			[
				1.8,
				2.48,
				3.23,
				3.2,
				3.14,
				3.8,
				3.7,
				3.4,
				3,
				2.6,
				2.3
			],
			[
				2.8,
				4.22,
				4.65,
				4.55,
				4.95,
				4.31,
				4.9,
				5,
				4.68,
				4.88,
				4.38
			],
			[
				4.27,
				5.78,
				5.68,
				5.88,
				5.46,
				5.98,
				5.95,
				5.2,
				4.83,
				5.3,
				5.63
			],
			[
				4.2,
				6.73,
				6.93,
				6.73,
				6.8,
				8.07,
				6.79,
				5.6,
				5.19,
				5.41,
				5.6
			],
			[
				5.68,
				7.13,
				7.78,
				8.2,
				8.11,
				9.3,
				9.09,
				6.65,
				5.84,
				5.71,
				6.5
			],
			[
				6.13,
				7.6,
				8.4,
				8.85,
				8.49,
				10.05,
				9.81,
				7.91,
				6.71,
				6.49,
				6.33
			],
			[
				6.38,
				8.6,
				9,
				10,
				10.35,
				10.05,
				10.45,
				9.31,
				7.9,
				7.14,
				6.35
			],
			[
				6.5,
				9.09,
				9.52,
				10.1,
				11,
				11.7,
				9.31,
				10.23,
				8.87,
				8.55,
				9.4
			],
			[
				5,
				7.1,
				8.7,
				10.1,
				11.1,
				12,
				12.4,
				12.5,
				9.45,
				11.3,
				10.4
			],
			[
				4.6,
				6.6,
				8.2,
				9.7,
				10.8,
				11.8,
				12.3,
				12.6,
				12.4,
				11.6,
				10.8
			]
		],
		"raw": [
			[
				2.28,
				2.48,
				3.23,
				3.2,
				3.14,
				3.25,
				2.7,
				3.25,
				3.03,
				3.68,
				2.38
			],
			[
				2.76,
				4.22,
				4.65,
				4.55,
				4.95,
				4.31,
				4.9,
				5,
				4.68,
				5.09,
				4.93
			],
			[
				4.27,
				5.78,
				5.68,
				5.88,
				5.46,
				5.98,
				5.95,
				5.2,
				4.83,
				5.3,
				5.63
			],
			[
				5.63,
				6.73,
				6.93,
				6.73,
				6.8,
				8.07,
				6.79,
				5.6,
				5.19,
				5.41,
				5.52
			],
			[
				5.68,
				7.13,
				7.78,
				8.2,
				8.11,
				9.3,
				9.09,
				6.65,
				5.84,
				5.71,
				6.17
			],
			[
				6.68,
				7.6,
				8.4,
				8.85,
				8.49,
				10.05,
				9.81,
				7.91,
				6.71,
				6.49,
				6.33
			],
			[
				7.25,
				8.6,
				9,
				10,
				10.35,
				10.05,
				10.45,
				9.31,
				7.9,
				7.14,
				6.35
			],
			[
				8.35,
				9.09,
				9.52,
				9.41,
				11.02,
				9.93,
				9.31,
				10.23,
				8.87,
				8.55,
				6.23
			],
			[
				6.71,
				10.17,
				10.06,
				10.5,
				2.1,
				null,
				9.95,
				10.82,
				9.45,
				9.09,
				8.92
			],
			[
				6.82,
				8.66,
				11.04,
				7.57,
				11.79,
				null,
				null,
				9.85,
				null,
				null,
				null
			]
		],
		"weights": [
			[
				2.1,
				30.6,
				99.4,
				86.4,
				27.8,
				13.1,
				8,
				8,
				6.5,
				11.7,
				.8
			],
			[
				11.1,
				46.2,
				281.3,
				248.6,
				120.1,
				59.3,
				78.5,
				57.7,
				68.9,
				79.8,
				31.5
			],
			[
				22.9,
				130.2,
				569.9,
				249.2,
				155.4,
				163.5,
				132.2,
				254.8,
				180.7,
				114.7,
				60.7
			],
			[
				12.1,
				160.9,
				909.4,
				366.1,
				113.8,
				141.1,
				103.9,
				223.7,
				298.4,
				95,
				15.7
			],
			[
				35.9,
				259,
				720.8,
				204.3,
				51.9,
				98.2,
				87.7,
				174,
				307.2,
				107.9,
				12.8
			],
			[
				65.8,
				468.9,
				636.9,
				115.2,
				32.1,
				72.4,
				135,
				130.1,
				280.8,
				112.8,
				88.1
			],
			[
				28.1,
				235.4,
				285.9,
				46.4,
				26.7,
				32.9,
				171,
				160.2,
				236.6,
				131.7,
				357.3
			],
			[
				21.6,
				64.5,
				66.5,
				9.3,
				16,
				15.8,
				61,
				92.5,
				153.2,
				99.5,
				13.6
			],
			[
				1.9,
				3.7,
				13.1,
				5.5,
				2.2,
				0,
				.8,
				4.7,
				28.1,
				2.8,
				1.1
			],
			[
				1.9,
				1.9,
				2.8,
				2.8,
				.9,
				0,
				0,
				.9,
				0,
				0,
				0
			]
		],
		"counts": [
			[
				1,
				15,
				48,
				44,
				17,
				9,
				6,
				6,
				5,
				9,
				1
			],
			[
				8,
				29,
				143,
				132,
				71,
				41,
				54,
				56,
				63,
				64,
				30
			],
			[
				17,
				76,
				306,
				137,
				99,
				99,
				92,
				229,
				170,
				113,
				58
			],
			[
				9,
				97,
				484,
				195,
				82,
				95,
				84,
				209,
				255,
				100,
				16
			],
			[
				25,
				146,
				393,
				119,
				45,
				71,
				89,
				185,
				306,
				102,
				10
			],
			[
				34,
				241,
				333,
				65,
				21,
				43,
				108,
				147,
				277,
				85,
				46
			],
			[
				18,
				128,
				166,
				38,
				18,
				20,
				112,
				180,
				250,
				98,
				166
			],
			[
				19,
				65,
				62,
				10,
				13,
				12,
				36,
				100,
				166,
				56,
				8
			],
			[
				2,
				4,
				14,
				6,
				1,
				0,
				1,
				5,
				26,
				3,
				1
			],
			[
				2,
				2,
				3,
				3,
				1,
				0,
				0,
				1,
				0,
				0,
				0
			]
		],
		"learnedCells": 74
	},
	calibration: {
		"method": "escale-v1",
		"base": "polar-escale.pol",
		"confidence": [
			[
				"escale",
				"blended",
				"blended",
				"blended",
				"blended",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale"
			],
			[
				"escale",
				"blended",
				"measured",
				"measured",
				"measured",
				"blended",
				"blended",
				"blended",
				"blended",
				"blended",
				"blended"
			],
			[
				"blended",
				"measured",
				"measured",
				"measured",
				"measured",
				"measured",
				"measured",
				"measured",
				"measured",
				"measured",
				"blended"
			],
			[
				"escale",
				"measured",
				"measured",
				"measured",
				"measured",
				"measured",
				"measured",
				"measured",
				"measured",
				"blended",
				"escale"
			],
			[
				"blended",
				"measured",
				"measured",
				"measured",
				"blended",
				"blended",
				"blended",
				"measured",
				"measured",
				"measured",
				"escale"
			],
			[
				"blended",
				"measured",
				"measured",
				"measured",
				"blended",
				"blended",
				"measured",
				"measured",
				"measured",
				"measured",
				"blended"
			],
			[
				"blended",
				"measured",
				"measured",
				"blended",
				"blended",
				"blended",
				"measured",
				"measured",
				"measured",
				"measured",
				"measured"
			],
			[
				"blended",
				"blended",
				"blended",
				"escale",
				"escale",
				"escale",
				"blended",
				"blended",
				"measured",
				"blended",
				"escale"
			],
			[
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"blended",
				"escale",
				"escale"
			],
			[
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale",
				"escale"
			]
		],
		"alpha": [
			[
				0,
				.13,
				.99,
				.83,
				.1,
				0,
				0,
				0,
				0,
				0,
				0
			],
			[
				0,
				.33,
				1,
				1,
				1,
				.49,
				.73,
				.47,
				.61,
				.75,
				.14
			],
			[
				.04,
				1,
				1,
				1,
				1,
				1,
				1,
				1,
				1,
				1,
				.51
			],
			[
				0,
				1,
				1,
				1,
				1,
				1,
				1,
				1,
				1,
				.94,
				0
			],
			[
				.2,
				1,
				1,
				1,
				.4,
				.98,
				.85,
				1,
				1,
				1,
				0
			],
			[
				.57,
				1,
				1,
				1,
				.15,
				.66,
				1,
				1,
				1,
				1,
				.85
			],
			[
				.1,
				1,
				1,
				.33,
				.08,
				.16,
				1,
				1,
				1,
				1,
				1
			],
			[
				.02,
				.56,
				.58,
				0,
				0,
				0,
				.51,
				.91,
				1,
				.99,
				0
			],
			[
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				.1,
				0,
				0
			],
			[
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0
			]
		],
		"ratios": {
			"pres|petit": {
				"ratio": .67,
				"cells": 3,
				"from": "groupe"
			},
			"pres|medium": {
				"ratio": .81,
				"cells": 8,
				"from": "groupe"
			},
			"pres|fort": {
				"ratio": .8,
				"cells": 0,
				"from": "secteur"
			},
			"travers|petit": {
				"ratio": .69,
				"cells": 6,
				"from": "groupe"
			},
			"travers|medium": {
				"ratio": .82,
				"cells": 8,
				"from": "groupe"
			},
			"travers|fort": {
				"ratio": .71,
				"cells": 0,
				"from": "secteur"
			},
			"largue|petit": {
				"ratio": .71,
				"cells": 2,
				"from": "groupe"
			},
			"largue|medium": {
				"ratio": .67,
				"cells": 8,
				"from": "groupe"
			},
			"largue|fort": {
				"ratio": .67,
				"cells": 1,
				"from": "secteur"
			},
			"arriere|petit": {
				"ratio": .67,
				"cells": 0,
				"from": "largue"
			},
			"arriere|medium": {
				"ratio": .67,
				"cells": 0,
				"from": "largue"
			},
			"arriere|fort": {
				"ratio": .67,
				"cells": 0,
				"from": "largue"
			}
		},
		"global": .76,
		"notes": [
			"20 nds / 40° relevée de 6.58 à 6.69 (monotone)",
			"20 nds / 75° relevée de 8.57 à 9.6 (monotone)",
			"20 nds / 90° relevée de 7.93 à 8.98 (monotone)",
			"20 nds / 110° relevée de 9.98 à 10.49 (monotone)",
			"25 nds / 110° relevée de 9.37 à 9.65 (monotone)",
			"20 nds / 120° relevée de 9.55 à 10.45 (monotone)"
		],
		"rules": {
			"W_LOW": 20,
			"W_HIGH": 100,
			"sanity": [.5, 1.5],
			"S4": {
				"165": .9,
				"180": .85
			},
			"ddwFrom": 165
		},
		"escale": {
			"table": [
				[
					3.24,
					3.69,
					4.24,
					4.44,
					3.95,
					4.22,
					4.24,
					3.69,
					3.08,
					2.68,
					2.5
				],
				[
					4.86,
					5.54,
					6.35,
					6.66,
					5.92,
					6.33,
					6.36,
					5.53,
					4.61,
					4.02,
					3.74
				],
				[
					6.48,
					7.39,
					8.47,
					8.87,
					7.89,
					8.44,
					8.48,
					7.37,
					6.14,
					5.35,
					4.99
				],
				[
					6.81,
					8.05,
					9.09,
					9.46,
					8.7,
					9.24,
					9.4,
					8.66,
					7.77,
					6.68,
					6.22
				],
				[
					7.15,
					8.72,
					9.72,
					10.06,
					9.51,
					10.05,
					10.31,
					9.96,
					9.39,
					8,
					7.44
				],
				[
					7.66,
					9.27,
					10.41,
					10.77,
					10.16,
					11.47,
					11.4,
					10.85,
					10.41,
					9,
					8.39
				],
				[
					8.18,
					9.81,
					11.09,
					11.48,
					10.81,
					12.9,
					12.48,
					11.74,
					11.43,
					9.99,
					9.34
				],
				[
					8.18,
					10.47,
					11.88,
					12.07,
					11.17,
					14.06,
					13.8,
					13.04,
					12.36,
					10.46,
					9.72
				],
				[
					7.83,
					10.48,
					12.05,
					12.52,
					12.37,
					13.2,
					14.08,
					14.88,
					14.47,
					11.84,
					10.98
				],
				[
					7.2,
					9.64,
					11.09,
					11.52,
					11.38,
					12.52,
					12.96,
					15.2,
					14.63,
					13.52,
					12.64
				]
			],
			"s4": [
				[
					3.24,
					3.69,
					4.24,
					4.44,
					3.95,
					4.22,
					4.24,
					3.69,
					3.08,
					2.77,
					2.62
				],
				[
					4.86,
					5.54,
					6.35,
					6.66,
					5.92,
					6.33,
					6.36,
					5.53,
					4.61,
					4.15,
					3.92
				],
				[
					6.48,
					7.39,
					8.47,
					8.87,
					7.89,
					8.44,
					8.48,
					7.37,
					6.14,
					5.53,
					5.22
				],
				[
					6.81,
					8.05,
					9.09,
					9.46,
					8.7,
					9.24,
					9.4,
					8.66,
					7.77,
					6.99,
					6.6
				],
				[
					7.15,
					8.72,
					9.72,
					10.06,
					9.51,
					10.05,
					10.31,
					9.96,
					9.39,
					8.45,
					7.98
				],
				[
					7.66,
					9.27,
					10.41,
					10.77,
					10.16,
					11.47,
					11.4,
					10.85,
					10.41,
					9.37,
					8.85
				],
				[
					8.18,
					9.81,
					11.09,
					11.48,
					10.81,
					12.9,
					12.48,
					11.74,
					11.43,
					10.29,
					9.72
				],
				[
					8.18,
					10.47,
					11.88,
					12.07,
					11.17,
					14.06,
					13.8,
					13.04,
					12.36,
					11.12,
					10.51
				],
				[
					7.83,
					10.48,
					12.05,
					12.52,
					12.37,
					13.2,
					14.08,
					14.88,
					14.47,
					13.02,
					12.3
				],
				[
					7.2,
					9.64,
					11.09,
					11.52,
					11.38,
					12.52,
					12.96,
					15.2,
					14.63,
					13.52,
					12.64
				]
			],
			"flags": [
				[
					["pres", "derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"]
				],
				[
					["pres", "derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"],
					["derivee"]
				],
				[
					["pres"],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[]
				],
				[
					["pres"],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[]
				],
				[
					["pres"],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[]
				],
				[
					["pres"],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[]
				],
				[
					["pres"],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[]
				],
				[
					[
						"pres",
						"lissee",
						"monotone"
					],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[]
				],
				[
					["pres"],
					["lissee"],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[],
					[]
				],
				[
					["pres", "monotone"],
					["monotone"],
					["monotone"],
					["monotone"],
					["monotone"],
					[],
					[],
					[],
					[],
					[],
					[]
				]
			],
			"dropped": {
				"tws": [35],
				"twa": [
					18,
					21,
					30
				]
			},
			"notes": [
				"35 nds : 15/25 cases vides — colonne écartée",
				"angles 18, 21, 30° : sous 35° du vent réel — écartés",
				"4 nds : plus rapide que le vent au portant (9/9 angles ≥ 150°) — reconstruite depuis 8 nds au même rapport vitesse / vent"
			]
		}
	},
	sailPlan: [
		[
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+genois",
			"haute+genois"
		],
		[
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+genois",
			"haute+genois"
		],
		[
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+genois",
			"haute+genois"
		],
		[
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+spi",
			"haute+spi",
			"haute+spi"
		],
		[
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+spi",
			"haute+spi",
			"haute+spi"
		],
		[
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+gennaker",
			"haute+gennaker",
			"haute+gennaker",
			"haute+spi",
			"haute+spi",
			"haute+spi"
		],
		[
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+gennaker",
			"haute+spi",
			"haute+spi",
			"haute+spi"
		],
		[
			"ris1+trinquette",
			"ris1+trinquette",
			"ris1+trinquette",
			"ris1+trinquette",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+genois",
			"haute+spi",
			"haute+spi",
			"haute+spi"
		],
		[
			"ris1+trinquette",
			"ris1+trinquette",
			"ris1+trinquette",
			"ris1+trinquette",
			"ris1+trinquette",
			"ris1+trinquette",
			"ris1+trinquette",
			"ris1+trinquette",
			"ris1+trinquette",
			"ris1+genois",
			"ris1+genois"
		],
		[
			"ris2+trinquette",
			"ris2+trinquette",
			"ris2+trinquette",
			"ris2+trinquette",
			"ris2+trinquette",
			"ris2+trinquette",
			"ris2+trinquette",
			"ris2+trinquette",
			"ris2+trinquette",
			"ris2+trinquette",
			"ris2+trinquette"
		]
	],
	loch: {
		"2026-06": .963,
		"2026-07": .991,
		"2026-08": 1.005,
		"2026-09": 1.017,
		"2026-10": .926
	},
	lochCorrection: {
		"method": "loch-v1",
		"events": "data/boat-events.json",
		"rules": {
			"window": "mois",
			"minSog": 3,
			"minStw": 2,
			"maxRatio": 1.5,
			"minMinutes": 360,
			"tackShare": .25,
			"deadband": .03,
			"kRange": [.92, 1.1]
		},
		"segments": [{
			"from": "2026-06-17T09:15:00.000Z",
			"to": "2026-10-27T12:00:00.000Z",
			"event": null,
			"estimate": {
				"k": 1.019,
				"ratio": .981,
				"minutes": 22638,
				"tacks": {
					"babord": 11257,
					"tribord": 11380
				},
				"bothTacks": true,
				"ok": true
			}
		}, {
			"from": "2026-10-27T12:00:00.000Z",
			"to": "2026-10-28T19:06:32.001Z",
			"event": {
				"at": "2026-10-27T12:00:00Z",
				"kind": "loch-nettoye",
				"label": {
					"fr": "Loch nettoyé",
					"en": "Speedo cleaned"
				}
			},
			"estimate": {
				"k": .978,
				"ratio": 1.022,
				"minutes": 413,
				"tacks": {
					"babord": 408,
					"tribord": 5
				},
				"bothTacks": false,
				"ok": false
			}
		}],
		"windows": [
			{
				"from": "2026-06-17T09:15:00.000Z",
				"to": "2026-07-01T00:00:00.000Z",
				"segment": 0,
				"basis": "segment",
				"own": {
					"k": 1.038,
					"ratio": .963,
					"minutes": 4819,
					"tacks": {
						"babord": 1006,
						"tribord": 3813
					},
					"bothTacks": false,
					"ok": false
				},
				"kRaw": 1.019,
				"k": 1,
				"why": "dans le bruit (±3 %)"
			},
			{
				"from": "2026-07-01T00:00:00.000Z",
				"to": "2026-08-01T00:00:00.000Z",
				"segment": 0,
				"basis": "mois",
				"own": {
					"k": 1.018,
					"ratio": .983,
					"minutes": 7768,
					"tacks": {
						"babord": 5749,
						"tribord": 2019
					},
					"bothTacks": true,
					"ok": true
				},
				"kRaw": 1.018,
				"k": 1,
				"why": "dans le bruit (±3 %)"
			},
			{
				"from": "2026-08-01T00:00:00.000Z",
				"to": "2026-09-01T00:00:00.000Z",
				"segment": 0,
				"basis": "segment",
				"own": {
					"k": 1.003,
					"ratio": .997,
					"minutes": 221,
					"tacks": {
						"babord": 153,
						"tribord": 68
					},
					"bothTacks": true,
					"ok": false
				},
				"kRaw": 1.019,
				"k": 1,
				"why": "dans le bruit (±3 %)"
			},
			{
				"from": "2026-09-01T00:00:00.000Z",
				"to": "2026-10-01T00:00:00.000Z",
				"segment": 0,
				"basis": "mois",
				"own": {
					"k": .989,
					"ratio": 1.011,
					"minutes": 3909,
					"tacks": {
						"babord": 2616,
						"tribord": 1292
					},
					"bothTacks": true,
					"ok": true
				},
				"kRaw": .989,
				"k": 1,
				"why": "dans le bruit (±3 %)"
			},
			{
				"from": "2026-10-01T00:00:00.000Z",
				"to": "2026-10-27T12:00:00.000Z",
				"segment": 0,
				"basis": "mois",
				"own": {
					"k": 1.082,
					"ratio": .924,
					"minutes": 5921,
					"tacks": {
						"babord": 1733,
						"tribord": 4188
					},
					"bothTacks": true,
					"ok": true
				},
				"kRaw": 1.082,
				"k": 1.082,
				"why": "recalé"
			},
			{
				"from": "2026-10-27T12:00:00.000Z",
				"to": "2026-10-28T19:06:32.001Z",
				"segment": 1,
				"basis": "aucune",
				"own": {
					"k": .978,
					"ratio": 1.022,
					"minutes": 413,
					"tacks": {
						"babord": 408,
						"tribord": 5
					},
					"bothTacks": false,
					"ok": false
				},
				"kRaw": 1,
				"k": 1,
				"why": "une seule amure : le courant ne se sépare pas du loch"
			}
		]
	}
};
//#endregion
//#region node_modules/tz-lookup/tz.js
var require_tz = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	function tzlookup(Y, W) {
		"use strict";
		var U = "XIXHXHXGXGXQXQXPXPXOXOXN##U6U6UW#$U%U%U%U%U%XFXEXEXRXRXVXVXWXWXXXXXYXYXZXZY#Y#Y$Y$Y%Y%XSXSXTXTXUXIXHXHXGXGXQXQVAVA#%#&V'#'U6#(#)U%U%U%U%U%#*U%XEXEVLVLVLVLYGYGYGYG#+W=W=W=W=W=W=Y$X+X+X+X+X+XTXUVPUQ#,T*T*#-VAVA#.#/#0#1#2U6U6UWU%U%U%U%U%#3VLVLXEYH#4#5#6YGYGYG#7X.#8W=W=W=#9X,X,#:#;#<#=#>VPVP#?#@#AT*T*#B#C#D#E#F#GV'#H#I#JUWU%U%U%U%X6X6#K#LYH#M#N#O#PYG#Q#R#SX.#T#UW=W=#V#WX,#X#Y#Z$#$$$%$&T)$'$(T*T*$)$*$+TW$,$-$.$/$0$1$2$3U%U%XJXJXF$4$5$6$7$8$9$:YG$;$<$=$>$?$@$A$BW3$C$D$E$F$G$HW8$IT)T)T)XHXGXGXQV=$J$K$L$M$N$O$P$Q$R$SV2XKXJXJXFY4$T$U$V$W$X$Y$Z%#%$%%VN%&%'%(%)%*%+%,%-%.%/%0W8XTT)XIXHXHXGXGXQXQU>%1%2%3TL%4%5%6%7U-XKXKX0X0XF%8%9%:%;%<%=%>%?%@%A%B%C%DX(%E%F%GWU%H%I%J%KXSXTXTXUXIXHXHXGXGXQXQU>%L%M%NTL%OUPXMX1XLXKXKXJX0X5%P%QS0%R%S%T%U%V%W%X%Y%Z&#WUWUWUWUWU&$&%X%XSXSXTXTXU&&ZDZDXGXGXQXQXP&'&(&)&*&+&,UOXLXLXKXKXJXJ&-&.&/S0&0T&&1&2WQ&3&4&5&6&7&8&9&:&;&<&=X%X%XSX%XTXTXUXIZDZDZDXGXQXQXPUI&>&?&@&A&B&C&DXLXKXKXJX3&E&F&G&H&I&J&K&L&M&N&OWEW<W<&P&Q&R&S&T&UY%X%ZUXSXTZYXUXIXHXHXGXGXQXQXPXPXOXO&V&W&X&Y&Z'#XKXKXJX3'$'%'&'''(')'*'+','-VMXXW<'.XZ'/'0'1'2WDZPZ9'3'4ZH'5XUXIXHZEZEXGXQXQXPXPXOXOZ@'6'7'8'9':';XKXJXJXF'<'='>'?'@'A'B'C'DXXXXZ1W'XZ'E'F'G'H'I'JW5Z9'K'L'MZWZ<Z<XHZEXGXQXQXPXPXOXOZ@'N'O'PUB'Q'R'S'TXJXFXFXESQ'U'V'W'X'YXWZ0XX'ZXYXZXZW4(#($(%W5(&ZS('ZB((()(*(+ZTZE(,(-XQXPXPXOXOXNU=U=(.(/(0(1(2(3XJXFX8XEXESN(4(5(6(7(8Z2XXZ+XYXZZ-Y#(9(:(;(<(=(>(?ZB(@(A(BZLZT(CZV(DXQXPXPXOXOXNXNU=(E(F(G(H(IXJXJXFXFX8XE(J(K(L(M(NZ*(OZ2XYXYXZXZY#Y#XCXC(P(QX;X;ZN(RZ>(SXHXHZVZVZA(TZQXPZ:XOXNXNV,(U(V(WV.V.XJXJXFXFXEXET((X(Y(ZZ*Z*XXXXXYXYXZXZY#Y#XCXC)#)$)%)&XT)'XUZ6XHXHXGXGXQXQXPXPXOXOXNXNV,)()))*V.XKXJXJXFX8XEXEXRSE)+SEXWXWXXXXXYXYXZXZY#Y#XC),)-).)/XDXAZ6Z6Z8XHXHXGXGXQXQXPXPXOXOXNXNV,)0)1T.XKXKXJXJXFX8XEXEXRXRXVXVXWXWXXXXXYZ/XZXZY#Y#Y$Y$Y%)2)3XDXTZ6Z6XIXHXHXGXGXQXQXPXPXOXOXNXN)4)5)6X9XKXKXJXJXFXFXEXEXRXRXVSESEZ/Z/XXZ/XYXZXZY#Y#Y$Y$Y%Y%XSXSXTZ6Z6XIXHXHXGXGXQXQXPXPXOXOXNXNV&)7)8X9XKX7X7X7XFXFXEXEXRXRXVXVXWXWXXXXXYXYXZXZY#Y#Y$Y$Y%Y%XSXSVEZ6XUXIXHXHXGXGXQXQXPXPXOXOXNXNVHVH)9):T9T9XJXJXFXFXEXEXRXRVIVIVIVI);VFVFVC)<VKVBVBVBVDVDVDVDVD)=VGXUXIXHXHXGXGXQXQXPXPXOXOXNXNVHVHT9T9T9T9)>VH)?Y&)@VJVJVJ)AVIVIVI)BVFVF)C)DVK)E)F)G)H)I)J)K)L)MVGVGVGVGVGVGXGXQXQXPXPXOXOXNXNVHVHT9T9T9T9)NVH)OY&)PVJVJVJ)QVIVIVI)RVFVF)S)TVKVKVK)UXCXCXCXCXC)VVGVGVGVGVGVGVGVGVGVGVGVGVGVGVG)W)X)Y)Z*#*$*%*&*'*(*)***+*,*-*.*/*0*1*2*3*4*5*6*7*8*9*:*;*<*=*>*?VGVGXNXNV'*?XLXLUWU%*>TF*?TFTFV'TFV'V'*>V'*?U6*?V8V8*?U%V8*@U%U%U%*@XYW=YGXYXHT*UQT*XQXQ*>*?VAVA*?*@*@TF*ATFTF*ATFTF*AV'TFTFV'*A*B*C*CTRV/XFVLVLYH*CYHYH*C*DXVXV*DYGYGX.YG*D*DW=X.*EW=*E*F*GX,X+X,*GX+X+X+*G*G*HWWWW*HWWWWWWXTXTWW*HVPVPVPUQ*GUQUQUQUQT*UQT**FV>*GV>*GVAV>*HVAVA*HVAVA*HVAVA*H*IVAVATFV'VAV'V'*HV'*IU6U6U6*IU6U6*IU6X6XFXFX4XEXEX4Y@YH*GYH*HYUYUYU*H*HY7Y7*I*IYGYGYGYGYG*IYGYGYG*I*J*J*KX.X.X.X.*K*L*LW=*MW=*MX,*N*OX,X,*OX,X,*OX,*P*P*QW;*R*RWW*SWB*S*TWBWB*T*UWB*VVPVPW8*VVPVP*VVPUQUQT)UQ*UT*UQT**U*VXQV0*VV=*WV=*W*XV=*Y*YV)*ZV)V)V?*ZV?V?*ZV?V?V'*ZV;+#U6+#U6V;V;+#V;V;+#U&+$U&XLXLU&V2Y@Y@XF+#Y@Y@+#Y@XEYHY@+#+#+$+%+&YU+&+'+(+(+)+*++YGYG++YG+++,+-+.+.X.+/X.X.X.+/+0X.+0+1+2+2+3+4+5+5+6+7+8W=W=W=+8+8+9W3W3W3+9+:W%X,X,+:+;X,+;X,X+X+X+X++;X+WBWRXSWB+:XSW8W8W8W8T)V=+9+:+;+;+<+=+>+>V)TTTTV)V?+>+?V?V?TL+?V;V;+?+@+@V;V;V;V;V;V;+@V;+@+A+B+BV2+CV2+C+DYIYI+D+EYI+F+F+G+H+I+I+J+K+L+L+M+N+O+O+P+Q+R+R+S+T+U+U+V+W+X+X+Y+ZVR+Z,#,$,%VN,%VNVN,%,&,'X(,',(,)W2X',),*X',*,+X'X',+,,W&,-,-,.WUWU,.,/,0,1X+,1X+,2WRXSWRX)WW,1,2WW,2,3U>,4,4TTTTTTTT,4TTTL,4,5,6,7,7,8UPUP,8UPUPUP,8U-XLXLXF,8XFY>,8,9,:YB,:,;YBYB,;,<YMYM,<,=YM,>,>,?,@,A,A,BY9Y9,B,CY9,D,D,E,F,G,G,HVS,I,I,J,K,L,L,M,N,O,O,P,QX(X(,QWUWU,Q,RWUWU,R,SWUWUWU,SWU,T,TX+,UY%X+X%X%X%,TX)XSXSU>,T,U,V,VTT,W,X,XTL,YTLTL,YTL,ZXF,ZXFS:,Z-#S:-$-$-%-&-'YMY*T&T&Y*-&-'S9-'-(S9-)-)-*-+-,-,X#--X#---.X#X#-.-/-0-1-1-2-3-4-4-5-6-7WUWTWUWT-6X%X%X%ZJZDXIZDV:-5XPUF-5-6UF-7-7-8-9-:TLTL-:UHTL-:UH-;-;UO-<UOXFX2XFSA-;-<-=SZS0S0-=->->T&-?-@-@S9-AS9S9-AS9-B-B-CWQ-DX#-D-E-F-FW9-GW9-G-H-IW<W<-IW<W<-I-JW<-K-K-L-M-N-NWU-O-PWUWU-PWUWUWU-P-QWUX%-QX%UI-QUIXO-Q-RUIUIUIUHUI-R-RU.-SV7-S-T-U-V-VV--W-XV<T+-X-YXF-YX3-Z-ZSZ.#SZ.#S2.$S2.$.%S2SY.%SYSYSYSX.%SXSX.%SH.&SH.&SHSH.'.'WQ.(.)WQWQ.)VM.)WE.*WEW<.*W<XZ.*X-X-X-.*.+.,.-.-WU..././WXWU.0.0Y$WDY$XN.0XNXN.0UAXNTNTDTDUV.0TD.0.1TITI.1TI.2T?XLU,XLXF.1XFS5.1.2.3.4.4.5.6.7.7.8.9SK.9.:SK.;.;SX.<.=SHSH.=.>SH.>.?S/.?.@S/.A.A.BSUSUW<W<W<.BW<.BW<.C.C.D.E.F.FW0W0W0W0WD.FWDZCXSZ9Z9XSXSZ9ZRZHZH.DZHTNXNZ@XN.CTD.DTDTD.DTD.ETI.E.F.G.G.H.I.J.JXKT@T@SB.JXFXFS-.JXEXE.JSKXET%.JS@.K.L.L.M.NSJ.N.O.P.QSF.Q.R.SS/.SSWSU.SSUSUXWW<.SXZW4.S.TW4.UW4W4W4.U.U.V.WWCWD.WWC.XY%ZP.X.YZ9ZRXSZRZRZFXTXTZHZHXTZWZ@U=XNU=.U.V.WU=.W.X.Y.Z.ZV+/#V+T@/#T@/$U#U#U#/$XJURU#URSL/#SL/$/$/%/&/'/'/(SO/)/)/*S>S>/*/+/,XWXYZ1Z+Z+W4/+W4/,/,WC/-WCWCW5WC/-W5/-W5/.ZSZ7ZS/.ZKZWXTXTZWZWZ?Z?Z?Z=ZZ/,/,ZT/-ZTZEXGZVZVZIZIZVZV/+/,U=/-/-/.U</////0TPTP/0/1/2/3/3/4T=/5/5XJT=XJSN/5SNSNSO/5/6/7/7S>/8/9S>Z.SR/9Z0Z0/9Z*/9W4Y#Y#/9WCY$Y$WC/9XCXC/9/:/;X>/;/<X>X;/<ZSX;XSZS/<ZSZSZBXT/<ZBXUZ?XUZ>Z>ZX/;ZXZVZV/;ZVZVZVZV/;U=/;U=/<U<U</</=/=/>/?/@/@V./AV.V./AV.V.XR/AXRT(/ASNT(/B/B/CSC/D/D/E/FSRSRZ*XWZ*XXZ2Z4Z2/DX>/EX>X>X;/EX;Z;Z;ZN/EZXZXZ6XIZAZQXQXQXMV,V,/C/C/D/ET0/E/F/G/HT(/H/I/J/J/KSE/L/LSR/MXV/MX>/NX:X>X;X:/NX;X;/N/OX;XS/OXSZNZNZMXTV,/NV,/O/O/P/Q/R/R/S/T/USE/USESEXC/UXCXC/UX:Y%X:X:/UX:/VXDXD/V/W/W/X/YT/T5/Y/ZT5Y%/ZY%Y%/Z0#X@X@XMV,XMV&/Z0#0$0%0%XLT4X9V&0%XMV&T90%XLXLV&V&T9T90$T9T9T9XXXX0$VFXZXZVCVKXTXT0#VGXJXJ0#VHXF0#VH0$0$SE0%SE0%VI0&VI0&VF0'VF0'VC0(VCVCVKVCVK0'0(VKVK0(0)VKVK0)0*0+XC0+0,XCXC0,0-XCXC0-0.XCXC0.0/XCXC0/00XCXC00VG01VG01VH02VHVH02VH0303SE04SE04VI05VI05VF06VF06VC07VCVCVKVCVK06XC07XC07VG08VG08VHVGVGVHVHVGVGT9T9VGVGT9T9VGVGT9T9VGVGT9T9VGVG03VHVGVGVHVHVGVGVH02VGVGY&Y&VGVG01SEVGVGVJVJVGVGVJVJVGVGVJVJVGVG0.VIVGVGVIVIVGVGVIVIVGVGVIVIVGVG0+VFVGVGVFVFVGVGVFVFVGVG0)VCVGVGVCVKVGVGVKVKVGVGVKVKVGVGVKVKVGVG0%XCVGVGXCXCVGVGXCXCVGVGXCXCVGVGXCXCVGVGXCXCVGVG/XVGVGVGXNXNV'U6XOXOVATFVATFVATFV'U6V'U6V'U6V'U6U6U6U6V8UWUWU%U%V8U%V8U%U%U%U%TRT*V>T*V>V>VAV>VAVAVATFTFVAVATFTFVATFVATFVATFTFTFV'V'TFTFV'V'TFTFV'U6V'U6V'V'TFV'V'U6V'U6TRTRU%TRYHYHYUYUYHYH/BY7YHYHY7YG/AYGYGYGYGX./AX.X.W=X.X.X.W=X.X.W=X,W=X,W=W=W=X,W=X,X,X,X,X+X,X+X+X+X+WWX+X+X+WWX+X+WWWWX+XSWWWWWWVPVPVPVPVPVPUQT*V>T*V>T*V>T*V>V>VAV>V>V>VAV>V>VAVAV>VATFTFVAVATFTFVAVATFTFVATFV'U6T<T<V'U6V'U6U6U6U6V;U6U6V;V;YHYH/)YUYUYU/)YUYU/)/*/+YUY7/+Y7Y7Y7/+/,YGYG/,YGYGYGYG/,YGYGYGX.YGYGX.X.YGYGX.X./)X.X.X.X.X.X./)X.X./)X.W=W=X.W=X.W=X.W=W=X,W=X,W=W3W3W3X,X,W3X,X,X,X,/$X+X+X,W;X,/#X,W;X+X+W;W;WWWWW;X)W;X)X+X+WWWWX)WWX)WBX+X+WWWWWWWBWWWWWBWBWWVPWBWBVPVPWBW8WBW8W8W8W8VPW8W8VPVPW8VPUQT*XHXHT*V@XQXQV=U8U8V0.LV=V0V=V0V0V=V=TZTZV=V=TZTZTSTSV=TSV=V=TWV)TWV)TWV)TW.GV).GV).HV'V'V?V'V'U6V'U6V;U6V;V;V;V;U6V;V;U6V;V;UWV;V;V;V;V;U&U&Y4.AY4Y4.AY@.B.CXEXEY'.CYH.C.D.E.EYU.FYU.F.GY,Y,.G.HY,.I.I.JYU.K.K.LZ&Z&.L.MZ&Z&.MYV.N.O.O.P.QYG.Q.R.S.T.T.UYEYE.UYG.V.WYGY=YG.W.W.X.Y.Z.Z/#/$/%YG/%/&/'/'X./(/)/)X./*X.X.X./*WOX.X.WOVNX.X.WIWI/(/)VNVNWIWIVNVN/(X&/)/*X&X&/*X&/*WHVN/+WHWHVY/+X&X&X&/+X&W=X&W=/*/+/,/-WG/-/.//W=//W=W=W=W=//W3W=W=W3W3W3X,W%W%W3W3W3W%W%X,W%/,X,X,/,X,X,X+X+X+X+WRX+WRWBWBW8W8V=V=/)V=V=U>XPU>/(U>U>U>V=/(/)/*TWTW/*/+U>U>U>/+TTTTU>TTTWV)TWV)TT/)TTTTTLTL/)TL/)TLTL/*/*TU/+/,V;V;/,/-V;U6V;V;V;/,/-/.V;TBV;TB/-UKUK/.U-U-U-/.TB/.V2V2V2V2U$UJ/-Y@Y@/.Y@Y@/./////0YI/1/1/2/3/4YI/4YI/5Y,Y,/5Y,Y,/5/6/7/7/8/9/:/:/;/</=/=Z&/>/?Z&Z&/?/@/@/A/B/C/C/D/E/F/F/G/HY</H/IY<Y</I/JY/Y//J/KY//L/L/MY<Y</MYG/N/OY<Y<Y</O/O/P/Q/RYGYG/R/S/S/T/UZ%/U/VYGYG/V/WYGYG/WYQZ%/X/X/YWJWJ/Y/ZYG0#VTVTVT0#0#X.WJVR0#0$VRVRVTVR0$0%X.WOVRWOWOVNWOWOVRVRWPWPVNVNWPWPVY/YVNVNVYVYVNVNVYW=VYVYVNVN/WX(W=W=W2W2W=W=W2W2W2W2X(W2W3W3X'X'W2X'X'X'W3W3/RX'/RW%W%W%W%W%W&W&W%W%/Q/RW&WUWUWU/QWUWUWUWUWUWU/QX,X,/QX,/QX+X+X+WU/QWUWU/QWU/R/SX+WRX+WRX+WRX+/RWWW8WWWWX)WWX)X)U>/PU>U>TETE/P/QU>/QU>TT/QTT/RTT/RTLTLTLTL/RTL/STUTU/S/TTL/TTL/U/UUP/VUPV;/V/W/X/X/YUPUP/YUPUPUP/YU-XLXLYBYBYB/YYBYB/YYBYB/YYB/Z/ZYB0#YBYIYI0#0$YI0$YIYI0$YM0%0&0&0'YMYM0'0(0)0*0*0+0,0-0-0.Y*Y*0.0/000101020304Y*04Y*05Y9Y905Y9XVYRY9Y9YR04Y9Y9YG04Y905YGYG0506Y906Y907YGYG0708VQVQVWVQ0708090:VWVW0:XWVQVQVSVQWSWSWS09VSVS090:WSWP0:WSWPWPWSVNVS09VS0:WS0:0;0<0<VN0=0>VNVN0>0?0?0@0A0B0B0CW,W,VNVN0C0DVNX(X(X(0CX(X(X(X(W2WUWUX'X'WUWUX'X'WUX'X'X'X'0@X'WU0@WUWUWUWU0@0@0AWM0BWU0B0C0DWMWM0DWTX%0DX%X%0D0E0F0GU>0GXPV:0GUYV:U/0GTT0H0IUY0I0J0KTTTTUU0KTT0KTTTLTT0KTLTL0KUP0LUP0LUP0MUPXFY>XFS:0L0MS:S:YB0M0N0OS:0OS0S00OT'0PT'YM0PT'YC0PT'S0T&0PT&T&T&0P0QY*XVT&T&T&S9Y9Y9XV0P0P0Q0R0S0S0T0UVO0U0VW(0W0W0XVUVUVOVUWQ0XVUVUWQVU0WX#0XX#0X0YVU0Z0ZX#X#X#X#0ZX#X#0ZVS1#1$1$1%W7W7W7W71%W7W7W7W71%1%1&W71'1'1(1)1*1*1+W9W9W91+W91,X(X(W9W<X(WUWUWU1*W<W<W<WUWUW<WUWTWT1)1*V:1*UFUFU/U/1*U/TM1*TM1+UFULUF1+1+UE1,1-1-TL1.1/ULUL1/UI1/1011UL11XNULXN11UPXNUPXNUPU.U.UPUPUP10UP1011UOX2S:1112S:S:SA12SASASASZSZS0SZS2S0S0S2S0S0T&S0T&S0T&S0S0T&T&SYT&T&1,T&S9T&S9T&S91+1,1-WQS91-S9S91-1.WQWQ1.X#1/X#1/10WQWQX#X#10X#1011W+1212X#WEWE12W9X#13X#W9WEXXW9W9W9121213W<W<W913W<W<13W:W<1414WU1516WUWU16171718W<19WUWU19W<W<WU19X-191:1;W<1;X-X-X-WUWUX-WU1:WU1;WUWUWUWU1;WUWU1;WUWUWU1;1<WU1<WU1=1=1>WXX%UF1>XOUI1>UIUIUIUI1>UIUIUI1>UIU*UH1>1?TH1?TAU*V7U.U.TKTKU.UOU.U.XMXMV7TDU71<U7XMUOU'U.UZUZ1;XMXMV-1;XMXMV%1;XLTI1;T,UN1<1<SASASZXFSZS=1<SASZSZSZSZSZS=SZSZS2SZS2SZS2SZS2S0S0S2S2S0S0S017S0SYSYSYSXT&SXSXT&SHSXSHSXSHSXSH13SHSHSHSHSHSH1313WQSHWQ13WQS1S1WQ1314VMWQWQVMVMWQWQWQWEWEWEVMWEW<11W<XZW)11XZX-X-111213X*VXX*X*12VX13VX1314VX15VX15VX1616W0X*17WUWUW0WU16WUY$Y$Y$WDWUWD15WDWDWD15U*XNXN1516TYUAUVTDUVTDXMXM1516TD16TD17XL17TIU(TI17TITIS=17S=18S=18S5S<S2S2S218S<S<18SBS<1819S<S2S2S21919T#T#T#191:S-S-T#1:1;S.1;SYT#SY1;SY1<SK1<T$1=1>SYSYSK1>SYSXSK1>SK1>1?S@SXSX1?SX1?SXSX1@SXSXS3S3SHSHS3SFSH1>SFSFSH1>SHS/SHSFSFSF1=1>S/S/1>VM1?1@S/SUS/S/VMVMVMSUVMVMSUSU1=W'1>W'W<XZW<X-XZX-W<VXX-VXX-1<1<1=1>WK1>VXVXVXWKWKVXW0WK1=WK1>WDWDW0Y$ZHZGZHZGUVUVTDXMXMTDU+U+TD1:TDTDTDTDTDUBTIU,TITCTITIUBUBTCTCUBTCU,16U,UXUXUXUXTJU,U,TCV+UXTJV+T@XKXK13XKSV13SVSV13S.14S.1415S.XESK1516S@SQS@SL16S@S@SLS7S3S3S315S3S3SJS3S@S7S714S3S314SOSFSFSO1414SOSOSOSOSOSO14S/S/SFS/13SG14SGSGSW14SWS/S/S/SUS/SUSUSUW<W4W4W4VX11W4W>11W>W>W>11W>1213W4W?13WLY$W?1314W?WD14W?W?WCWLWCWD13WCWCWCWCWCW5W5ZPW5W5ZPY%W5W5U+U+1011U+U+11U=U=11U=U=TDTDU=U=TDUBTDUBU=U=U=TXTXUBTXUBUBV+UBUBUBV+UBV+T@U#T@U#1*U#1+U#U#U#1+U#SL1+S7S71+1,1-1.S71.S7SJSJSJSJSO1-SJSNSJ1-SOSJSOSJSOSOSOSO1,SO1-SO1-SOSO1-SG1.S>1.SWS>1/SWSW1/SWSUSUSWXW1.1/S>S>1/WLWLWLW4WLW4W4WLWLWL1.WLWCW4W4WCW5WCW5W5Y%W5ZSW5ZSW5ZSZ7Z7Z7ZBZZXIZZZ5Z=XHZOXHZOXHZ5ZO1&V*U=U=V*TXV*1&U=U<U=U<UB1%U<V$V$UBV$TPV$1$U<U<UBV+TPTPV+V+TPTPT@T@TPT-T-U#T-U#TPT-TPV.T-0W0XT=U#U#T=T=0W0X0Y0ZT=0ZT=T=0Z1#U@U@SNSNSN1#SOSOSOSPSNSPSPSP0Y0ZSPSP0Z1#SPSPSP1#SP1$1$SR1%SRZ.Z.XWZ3Z3Z*Z3Z*W4W4Z,Y#W40ZY$Y$WCW*WCW*W5W5Y%X>W5Y%X>Y%Y%X>XCX>Y%W5X>Y%W5ZSY%X;ZSZSX;XSZBZBZSXSZBZBZ;Z;Z>Z>Z>ZXZTXGXGZVZVZVZVZAU=U<0NU<V,0NV,0OU<U<U<0OU<T;0OT;TPTPU<TGTPTPTGTGT;0MT;TGTGTG0MTG0MV.V.V.0MV.0NV.0NT=0OT=SNSNT(T(SNSN0NT(T(SCT(SCSPSPSC0MSP0M0NSDSDSD0N0OSDSRSDSD0NSRSRSRSD0N0OSRXCX>XCX>XCX>XCX>X>0MX>X>Z;XTZNZNV,T/0L0MT10MT50N0NT;T0T00N0O0P0QT;T;0Q0R0R0S0TV.T0T;T00T0T0U0VV.T(SCT(SCT(T(T(SET(SESESESCSCSC0S0SSESESESESE0S0TSESR0TSR0TSESESEXCX>XCX>XCX:XCX:X:X;X:XDX;X;XDXDX;X;XD0PX;X;0P0Q0QT60R0S0ST30T0UT2T0T70UT0T0T00UT70UT5T50U0V0WT.T00W0X0Y0YV.UM0Z0Z1#T.T.UMUMT.XL0ZSESESEXCXCXCX?0YX:X?Y%X:XDX:0YX:0YX:0ZXDXDXB0ZXDXD0ZXDV,V,V,0Z0ZT5T5T5V,0ZV,V,T.T.0ZT.T/0ZT/T/X:0ZY%Y%XBXBX=0ZXBXBX@X@V,0YV,T40Y0ZT4T4V&T4V&V&T4T40YT40YT/T4T4V&T9V&V&XLX9T9XLT9T9V&T9VIVFVIVFVDVGVDVGXJXJT9VHXFXFVHY&VHY&VHY&Y&SEY&SEY&SEY&SEVJVIVJVIVJVIVJVIVIVFVIVFVIVFVIVFVFVCVFVCVFVCVFVCVBVBVKVKVBVBVKVKVBVBVKVKVBVBVKVKVBVBVKXCVBVBXCXCVKXCVKXCVDVDXCXCVDVDXCXCVDVDXCXCVDVDXCXCVDVDXCXCVDVDXCXCVDVDXCXCVDVDXCXCVDVDXCXCVDVDXCXCVDVGXCVGXCVGXCVGT9VHT9VHT9VHT9VHVHY&VHY&VHY&VHY&Y&SEY&SEY&SEY&SEVJVIVJVIVJVIVJVIVIVFVIVFVIVFVIVFVFVCVFVCVFVCVFVCVKXCVKXCVKXCVKXCXCVGXCVGXCVGXCVGXMVHVGVHT9VHT9VHVHY&VHY&Y&SEY&SEVJVIVJVIVIVFVIVFVFVCVFVCVKXCVKXCXCVGXCVGYHYH/U/VYHYH/VYGYGX.YGYGYHYHYH/UYH/UYHYU/UY7Y7Y7XRY7/UYDY7Y7/UY7YU/UY7Y7Y7Y7/U/VY7/VYGYGYGYG/VYGYGYG/VY=YGX.X.X.X.X./U/VX.X.X&X&X,X,/UW3X,W;X,X,V=V=U8V=TWV)TWV)V)V?V)V?V)/QV)V)Y4Y4Y4/QY@Y@/QY@/Q/RY4Y4Y8/RY@Y@Y'Y,Y'/RYHYHYH/RYHY3Y3Y3Y3/QY3Y3/QYUYUYUYUYUY3YUY3Y3/P/QY3Y3/Q/RY3/RY3Y3YUYU/R/SY,/SY,/TYUYDYUYUYDY7YVYV/R/SYL/T/TYUY3Z&YUXRZ&Z&XRY;/SY;/SZ$Y;/TY7/TYVYVYLYLYL/TYL/TYLYL/T/UYVYG/UYGYGYG/UYGYL/VZ$Z$/VZ$Z$Z$Z$/V/V/WZ&/X/X/YYEYE/YYEYEYE/YYEYEYEYGYGYEYGYE/XYEYEYGYG/XYG/XY=/YYG/YY=Y=Y=Y=Y=Y=/YY=Y=YGY=Y=YN/XYNYGYGYG/XYGYGYG/XYG/XYGYGYXYXYX/X/X/Y/Z0#0#0$YNYNYN0$YN0%Y=X.0%X.YN0%0&0'X.X.0'X.0'0(0)0*0*X.X.X.X.0*X.WOX.X.VNVNX.WIVN0)0)0*0+X&WIX&WIWHX&X&WHWHX&X&WHX&WHWHWIWHWH0'VN0(0(WHVYVYX&X&X&0(WH0(WHWH0(WG0)WGWH0)VYVYVY0)VYVY0)0*W=W=0*WGVYWGWGW=WGW=W=0)W=W30)W3W3W3X,X,WUWUX,X,WUWUV=V=0'0(0(U>U>U>TWTWV=TWV=V=0'0(V=V=0(TOTWTW0(TWTWTWTW0(U>U>U>0(TLTL0(US0(TLTTTL0(TLTLTLTL0(TLTL0(V;TUTU0(TUTLTL0(TU0)0*TU0*TUTU0*V;TU0+V;V;UP0+V;UPV;UPUP0*UP0+V;V;UKUKUKU-UKU-U-0)U-U-U&V20)V2Y4Y4XEY@Y@Y@YIYIY@0'YI0(Y@Y@YIYIY@Y@Y@0'Y@Y'0'0(YI0(YIYIY'Y'0(0)0)0*0+Y,0+0,YIYI0,Y,0-0.YIYIYI0.0.0/YI00Y,Y,00Y,Y,000102Y,02Y,0303YK04YK04Y,0506Y,Y,06070708YM09090:YMYMY,0:0;0<0<0=Z#Z#YM0=YMYM0=0>0?0@Z&Z&0@Z&YK0@0A0B0B0C0D0EZ&Z&0E0FZ&Z&0F0GZ#0GZ#0H0HY-0I0J0J0K0L0M0MY00N0O0O0PY0Y00P0QY00R0R0S0TY+0TY/0UY/0U0VZ&0W0W0XY<Y<0X0YY<Y<0YYEY<Y<YEYEY<Y<0X0YY/Y/Y<0YY/Y/0Y0ZY/1#1#Y<Y21$1$1%1&1'1'1(1)Y<1)Y<Y<Y<YGYGY<1)Y<1)Y<Y<1)1*Y<Y<Y<1*YRYRY<1*1+1,1,Y<Z(1-1-1.YRYRZ(1.YRYG1.1/Y<Y<YGYG1/YGYG1/101111121314Z%Z%YGZ%Y<Y<131414YGYGYGYG14YG15Z%1516YG16YQ171818YQWJWJYQ18YQWJ18X.WJWJ1819YGYGWJWJY)19Y)Y)YGY)VTVTVQVQX.X.17WJX.X.X.17X.X.17X.1718VQVQ18VQVQVQVYVY18VYX(X(18X(X'18X'X'W3W318W%18W%WU1919WUWUWUW%WUWUWUWU18WUWU18X,WUWUX,X+X+X+WUX+WUWUX+X+WUWUWUWU15WU15X+16X+WRWRX%16U>TETETETETEU>U>TETETTTT13TTTTTTTETTTETETETE12TT12TLTLTLTL12TLTUTLTUTL12TUTU12TUTU121314141516U016171819U019U01:U01:1;UPV;V;V;1;1;V;1<UP1<1=UPUPV;V;1=1>V;1>UPUP1>UPUPUP1>U-XLU-YBYB1>1?YBYB1?1@YIYI1@YI1@1AYBYB1AYB1BYB1BYBYBYB1B1CYBYB1C1DYBYBYI1DYI1E1EYM1FYMYIYIYI1F1FYM1GYMYMYMYM1GZ'Z'YMZ'1F1GZ'Z'YPYP1GYPZ'Z'YMYM1F1GYMYJ1GY+YPY+Y+1GY+1H1H1I1J1KY+1K1LYSYWYWY*Y*1K1LY*Y*1LY/1M1NY/Y/1N1OYTYT1O1PYTYT1PYT1P1Q1R1SY/Y/1SXVYTYT1SY9YTXVY9Y9Y*1RY*Y*Y*Y*Y*1R1RY91SY9YRYGXVXVYGYG1RYGWZWZY9Y9WZWZWZ1QWZ1QWZWZ1QX/1R1SY91SY91T1TYG1UWZYGYG1U1V1VVW1W1XVWVWVW1X1X1YX#X#1Y1ZX#X#1ZXW2#X#2#2$VSVSVSVSX#2$VSVS2$2%WSWS2%WSWSWS2%2&VS2&VSVSWSWYWS2&2&2'VSVSWSWSVSWS2&VN2'VNVNVNVN2'VNVN2'2(2(2)2*W#2*2+W#W#WY2+2,2-2-2.2/2020W,21W,W,W,21W7212223W#W#W#W#X(22W#W#W#W#22W#W#W#W#X(X(X'X'WUWUX'WUWUWUWUWUWU2/WU2/20WM20WMWMWMWMWM2021WU21WUWUWUWU21WM2122WMWM22WT23WTX%X)X%X)U>U>U>2222TTUYUYU>22U>U>UYUY22UYU>U>2223U>U>2324TT24UYTTUY24UYUYUY24UY25UY25UYUYU/25U/U/2526U/U/26TTTMUUTTTLTLTLTLTL25TL2526TL272728TLUPTL28TL29TL29TL2:2:YBYB2;YBYB2;YBYBYBS0S02:2;S:S:2;S02<S0S0S0S:S0S0T'2;T'2;T'2<T'YMYMYCYCT'T'S0T'2:T&T&T&Y*2:Y*2;Y9Y92;2<2<2=WFWFY9Y92=Y9Y92=2>2?2?W(WFVZW(W(2?W(XV2?W62@2@W(2A2B2B2CS9W62CY9W(W(2C2DW(W(W(2DW(2E2E2F2GVU2GVUVUVUWQ2GWQWQ2GX#2H2IVU2I2JX#VU2JVUVUX#X#2JX#2JX#VU2KX#2KX#X#X#2KX#X#2K2LX#2MX#W72MW72MW7W7W7VS2MW7W7W72MW7W7X#2MX#X#W7W7W7W9W72LW7W72LW7W7W7W7W72L2MW,W,2MW9W7W9W9W92LW9W9W9W9W9W9W<W7W7W72K2KW92LW92L2MW92NW92N2O2PW<W<2PW<WT2PWTX%2PX%X%X%V:U/V:V:UFU/UFUFTMUUTMTMTMTMTM2MUFULUFUF2LTLTMUETM2L2M2NUEULULULTLTL2MTLUL2MULULTLTL2MTLULUIULUIULUL2LULUL2LULUL2LULUIUL2LXNUEXN2LUPXNXNUPUOUPUOUPUOUPUOUPU.U.U.X2SASASAS:S:SASASAS0SASZ2FS9T&S9S9VO2F2GVOWQWQWQS9WQS9S9WQWQS9WQVUVUWQWQW@2CWQ2DX#X#WQX#WQWQWQ2CWQ2CWQWQ2CWN2D2EX#X#2EX#WNX#W+W+X#2DW+2EW+2EW+WE2EX#2FXXX#2FX#2GX#W9X#W92FW<W<W<W92FW92G2GW<W<W<W9W<W9W9W<2FW<2GW<2GW<W<W:WUW:W:W:W:W<W<W:W:2EW:2EW:W:2FW<X$2F2GW<W<W<2G2G2H2IW)2IW)W<W)X$X$2IW<W<W<W<2IW<W<W)2IW<W<2IW<W)2IW)2JW<X-W<X-X-WU2IWU2IWUX-X-WUWUWU2IWUWUVXWUWUWUWU2HWUWU2HWUWUWU2HWUWUWXY$WXWUWX2GWXWXY$2GX%UFUFUF2GUFUI2GUIUI2GUIUIUHUHUIU*UHTH2FTHUH2FUHTHUH2FU*TAU7UZU7U7UZV-XMV-V-V%XMXM2CV<V5V52CV1U;2DU)U)TVUDXFSAXF2C2CS=S=S=S0SYSYSYS92BSHSHSHS1SHS1XWWQSHWQSHSHS1S1WQWQVM2?WQ2?VMVMW<W)W<W)W)X-2>X-WUWUX-X*X-X-VXVX2<X*VXVXVXVXX-VXX-2;X-VXX*2;VXVXVXX*VX2;VX2;VXVXWUWUVXVXVXVXY#WU29VXX*VX29W0X*W0WU29WUWUWXWXWXWDUI28XNXNU*V7TYTYV7V72728TI28TITITQU;28TITDTITITITITI27TIUDUDV6V4V#V#26TIS=S=262727S=S5S5S=S2S=S2S2S2S<S2XF25XFSBS<S2S<S-SBS<24SVS2T#S2T#S2S2S2T#S2S2S-S-T#T#21T#S.21S.S.S-S.S-21SYSY21SYSYSYSY2121SKSKSK21T$SMT$S.21S.SMT$SKT$SK20SKSKSKSKS@SK2020S@21SXSK21SKS@SXSX21SX21SX22SXSXSXSXS3SHSHSHSFSHS1SHS/S/2/S/S/2/S1S/S/S1VMS1S1S/2.S/S?VMVM2.XWW<W<2.W'W<W'W'W'VXVX2-Y#VXVXVXWK2,VXWKWKVX2,VXVXX-2,X-VXX*W0WKW0WKW0W0W0TITITD2*U,XLU,UXTJXKTJT@SV2(SVSV2(S.S-S.2(S.XES.2(2)2*2+2+SK2,SKSKSKS@S@SKS@2+2,SQSQSLSLS3S3S32+S7SJS7SJ2*S3SOSOSFSF2*SOSOSOSJSOSOSOSO2)SOSGSO2)2)SGSGSGSG2)2*SWVXVXW>2*VXVXVXW>W>W>2)W>W42)W4W42)W4W4W4WL2)WLWLY$W$W?2)2)W?W?W?W?W?WC2)WDWDWDWCXMU+U=U+U+U+2'U+U+U+2'U=U=U+U=U=T@U#T@2&T-U#T-U#U#U#U#2%SLS7SLS7S72$2%2&S7S7SJ2&SN2&XRSN2&SNSNSNS7SJSJSJ2%SJSJSJSJSJSJSOSO2$SO2%2%2&SO2'SOS8SO2'SGSG2'S>2'S>S8S>2'SW2(2)S>SWS>S>SWSW2(SWS>SWS>S>SWXW2'XWWLWLW4WLWLWC2&WCU=V*U=U=V*V*V*U<UBUBUB2$V$V$V$2$T-T=T-T=2#V.V.V.U#V(2#T=V(V(T=2#2#T=T=T=T=2#T=U@T=2#T=T=2#2$2%2&V(V(2&XJSNSNSN2&SO2&SP2'SPSP2'SOSOS>SPSPS>S>2&S>SPSPSP2&2&2'SR2(S6SRS6SRS6SR2'S6WCWC2'WCU=U=2'2(2(U<V,U<V,U<V,U<U<U<2'U<U<U<2'T;2'TGTGTGTGTG2'TG2'V.V.V.TGV.TG2'2'V.V.V.T=T=V.2'V.T=V.V.2&SNT(T(SPSPSC2&SPSPSPSDSPSDSDSDSC2$SCSCSDSDSC2$SRS6SR2$2$SRSDSRSDSD2$SDX>X;X>X;V,V,V,T6T2T2T6T2T1T5T1T51XT5T5T5T51XT5T5T/T/T/1XT8T01XT0T21XT2T21XT0T/T0T0T0T01X1XT;1YT;1YTGT;TGTGV.V.V.T;T;T;1XT0T0T01XT;T01X1YT0V.V.V.1XV.V.V.SC1XSE1YSC1YSCSESE1YSE1Z1ZSESSSESESESE1ZSESTSESEX;X;XDXDX;X;XDXD1W1XXDXDV,T6V,T6V,T6V,T31VT3T3T3V,T3V,T3V,T3T51UT3T31UT51UT01VT0T0T0T01VT7T0T71VT01V1WT.1WT.T.T.1WT.T.T.1W1X1YUMT01Y1Z2#2#UMUMUM2#V.UM2$2$2%UMV.T.2%T.T.2%UMT.2&SE2&SESEXCXCX?2&2&XDXDXDXB2&XBXBXBXB2&XB2&2'XBXB2'XBXBXBV,2'V,2(2(T5T5T5V,T5V,T/T.T.2'T.T5T5T/T/2&XBXBXBX=XSX@X@V,2%V,T4T/T/T42%T/T/2%2&T4T4V&T4T/T/T4T4YU2$YUYU2$Y72%Y7YHYH2%2&YHYHYHYUYUYUYH2%YUY7Y7Y7YUYDYUYDYDY7YDY7YUY7Y7Y7Y7Y7Y71YY7Y7YGYGY7Y7YGYGYGYGY7YG1VY=Y=Y=1V1WX&X&X&1WX&X&X,X,X,W3V?V?V)V?Y4Y4Y41U1UY@Y@1V1V1WY4Y4Y@Y@Y4Y4Y8Y8Y@Y@1U1V1W1XYH1XYUYUY3YUY3Y3YHYU1WYUY,1WY,Y,1WY3Y,1XY3Y31XY,Y3Y3Y31X1XYUY31YYUYUY,Y,Y3Y3Y,Y3Z&Z&1WZ&1WZ&1X1YXRYVYLYLYVYVYLYLYLYLYL1WYUYUY3YUZ&Y;Z&Z&Z$1UZ$Z$Y;Z$Y;Y;Y7Y7YVYVYLYL1SYLYL1SYLYLYVYGYVYVYGYGYV1RYGYG1RYGYVYVYLYLYLYGYLYLZ$Z$Y;Z$Z$Z$Z$YEZ&1NZ&Z&Z$Z$1NYE1NYEZ&YEZ$1NYEYE1NYEYEYEYLYLZ$YEYEYGYEYEYEYGYE1LYEYGYGYG1KY=Y=Y=Y=Y=YGYGYGYGY=1JY=Y=Y=1JY=Y=Y=1JYGYGYG1JYGYGYX1JYGYX1JYX1J1KYQYN1K1LYGYGYN1LYGYGYGYGYG1LYGYGYG1LYXYX1LYNYXYN1LYNYNYNYN1LYNX.X.X.Y=Y=1KYNYNX.YNYNYNYN1J1KYN1KYN1LX.X.1LX.1LYGYGYGYN1LYG1MYGYGYG1MX.X.1MX.X.1MX.X.X.1MX.WOVN1MVNVNX.X.X.1MX.X.X&X&X.1LX&X&WHWH1LWHVYVYVN1LVYWHVYVYX&X&X&WGX&WHWHWHWGWG1IWGWHWGWHWGWHVYVYVYVY1GVYVYWGWGWGW=W=W=1FW=WGWG1FWGW=1FW=W3W=W=1FW3V=V=V=1FV=V=1F1GV=1GU>U>V=V=U>U>V=V=U>1FV=V=1FU>TWTWTTTTTWTWTTTTU>TEU>1DTT1DTTTT1D1ETLTL1ETLTLTLTL1ETLTLV;1EV;V;1ETU1F1GTUTUUGTU1FUG1G1HTUTUTLTLTU1GTUTU1GV;TUV;V;V;TUTU1FUKUPUKUP1FUPUKUP1FUPUPU-U-U-1FTBTBTBV2Y@Y@Y61E1EY6YI1FY@Y@1FYIYI1FYI1G1G1H1IY.YI1IYIYI1I1JY.Y.1J1KY.Y.Y'Y'1K1L1L1M1NY,1N1O1P1Q1QY.YI1RY.Y.1RY.Y.Y,1R1S1S1TYIYI1TY,1U1V1V1WZ)Z)YI1W1X1Y1YZ)1ZZ)1Z2#2$2%Y,Y,2%2&Y,2&Y,2'Y,Y,Y,2'Y,2'2(2)2)2*2+YKY,YKY,Y,2*YKYKYKYKYKY,YK2)Y,2*Y,2*2+Z)Z)2+2,Z)Z)2,2-2.Z#2.Y,Z#2/Z)Z)Z)2/Z)Z)2/20YM20YMYMZ)20212222YMYMYMY,Y,Y,2222232425Z#25Z#Z#25Z#Z#Z#2526Z#Z#2627YMYM2728292:2:2;Y?Y?2;2<Z'Z'Y?Y?Z'Z'Z&Z&2;2<YKZ&YKYKYKYKYK2;YKYK2;2<2<Z&YKYKZ&Z&2<2=YKYK2=2>YK2>2?Y-2?2@Y-Y-Z&Z&Y-Y-2?2@Y-Y-2@Z&Y-Y-Z#2@Z#Z#Z#2@2A2B2BY-2C2DY02DY0Y02D2EY0Y0Y?2EY?Y?2E2FZ'Z'2F2GZ'Z'Z'Z'2G2HY0Y0Y02HZ'Z'Z'2HZ'2H2I2JY-Y-2J2KY-2K2L2M2M2NY0Y02N2OY0Y0Y0Y/2OY/Y0Y02O2PY0Y02P2Q2QY+2RY+Y02RY/2SY/Y/Y+2SZ&2SZ&Z&2SYEYEYE2SY<Z&2TYEYE2TY<YEYEY<Y<Z&Z&2SY<2SY<Y<Y<YEYEY<YEYYYY2RYYYYY<2R2SY<Y<Y<2SY<Y<Y/Y/Y<2RY2Y2Y2Y2Y/2RY<Y<2R2S2SY<Y22TY2Y2Y22TY22TY<Y<2TY<2U2VY<Y<2VY/YEYEYE2VYEYEY<Y<2U2VY<Y<YGY<Y<Y<YGYGY<Y<Y<2TY<Y<2T2UY<Y<2UY<Y<Y<Y<Y<Y<2UY<Y<2U2VY<2VY<Y<2VZ(Z(Z(Y<Y<Z(Y<Z(Y<Z(Y<Y<Y<2TY<Z(Z(Y<Z(Z(Y<XVXVYGYGY<2RYGYGY<YGY<2QY<YGYGYGYGYQYGYG2PZ%2P2QZ%Z%YQ2QYQYQ2QYQYQYQYQYQZ%2QYQYQZ%Z%Y<2PY<Y<2PYGYGYGY<2P2Q2R2RZ%Z%Z%YG2RYGYGZ%Z%Z%YG2QYGYGYG2QYQYQYQYQYQ2Q2RYQYQ2RYQZ%WJ2RWJYNYNYQYQYNYNYN2Q2Q2RYGY)Y)WJY)Y)Y)VTY)Y)WJ2PWJWJX.X.VRVR2OX.VRX.VTVTVT2OVTVT2O2PVTVT2PVQVYVYVNVNX(X(2OX(2O2PX'X'2PW%W%W%W%W%W&W%2O2PWUWUW%W%2PWUWU2PWUWU2PX,X,X,WUWUWUX+WUWUWUX+2NX+X+X+WRWRX%X%2MTT2NTTTT2NTTTTTTTTTT2NTLTUTLTU2M2NTL2O2OTUU0U0TUTU2O2PTU2PUPUP2PV;UPUPTLTLTLU0TLU0U0U0TL2NTL2OTLU0TL2OU0U0U5U0TL2NTLTL2NU22OTLU0UPU0UPU02NU02OU0UPUPUP2N2OUPUPV;V;V;2O2OV;V;V;V;UPUPUPV;V;V;UPV;2MUPUPV;V;UPUPV;V;UPUP2KUPUPUP2KUPUPUPUPUKUPUKYB2JY>Y>Y>2JY>Y>2J2KY>Y>YBYB2KYBYIYI2KYIYB2KYBYBYIYIYBYBY>2JY>2KY>2KY>YBY>2KY>YBYIYIYBYBYIYIYB2JYIYI2J2KYIYI2K2L2LYM2M2NYI2NYIYIYMYM2NYM2NYMYIXRYIYIYI2N2NYMYIYMYIYMYIXR2MYMYMYMZ'2MZ'Z'YPYP2MYPYPYPZ'2MZ'2MZ'Z'2M2N2O2P2P2Q2R2SY/Y/Y+Y+Y+2RY+Y+YJYJYJ2RYJ2RYW2SYJ2SXRYWYWYWYW2SY+Y+2SY+2S2TYSYS2T2UYWY*2UY*Y*Y*2UY/Y/Y/2U2V2WYTY/Y/YTYTY/2VYTYT2V2WYTYTYSYTYSYTYTYTYTY*YTYT2UYTY/Y/2UY/Y/Y/2UY/2UYTYTYTYT2UYTYT2U2VYTYT2VY92WY9Y*Y*Y*Y9Y*2VY*Y*Y*Y9Y9Y92UY9Y*Y*YGYGYG2UWZWZY9WZYGYGWZWZY92SY92TY92TY9Y92T2U2VX#2VX#X#X#Y9X#Y9X#YGYGWZYGWZWZ2TWZYGYG2TYGYG2TYGVWX/VWX/VWX/X/2SX/VWVWX/VWVWVW2RVW2R2SX#X#2S2TX#X#2TX#X#X#X#VWX#2TVWVW2TVWX#VWX#X#WSWSVSVSWSWS2R2SVSVSX#X#VSVS2RVSVSVS2RVS2RWS2SWSVS2SVSVSWSWSVSWSVS2RVSVSWSWYWS2R2R2SVS2TWSWS2TWSVNVN2TVNWP2TWPVNVNVNVN2TVNVN2TWYWYW#W#W#2SVNW#W#VNVNW#W#W#W#2R2SVNW#W#W#W#2RW#W#2R2S2TWYWYWY2T2U2U2V2WW,WY2W2X2Y2Y2Z3#3$3$3%W#3&3&3'W#W#W,3'WS3(WS3(WSW,W,W,3(W,3(3)3*3+3+3,3-3.3.3/W#W#3/30W#W#VNVNW#W#3/WUWMWMWUWU3/WMWU3/30WMWU30WMWMWMWMWM30303132WTWUWUWU32WUWUWU32WU32WMWM32X+WMX+WMWMWM323233WTWTU>U>U>33U>TTU>UYU>32U>3333UYUYUYU>33XPV:3334V:V:V:34V:V:V:34V:U/TTTT34TT34TTUYUYTTTTUYTTUYTTUY33UYTTUYTTUYUYU/32UYUYU/U/UYTT31U/3132UUUU32TLTLTLTL32TLTLUPUP3233TLUPTLUPTLTLTL3232UPUPUPUPUP32UP32UP33UP33UPTLUPTLUPUPUP32YBYBYBYBYBS:3232YB33S:S:33S:S:S:S0S:33S0S033S033S0S0S0S033S034S0S0S034S034T'T'T'T&34T&Y9Y93435Y*35Y*Y*35Y9Y*XV35Y9Y*Y9WFW-WFWFW-34WF35Y9Y9W-W-Y9Y93435Y935363737W(W(W(W-W-37WF3738393:VZVZ3:3;3;3<3=W/3=W(3>W(3>3?VOVOW(W(VOVOW.3>S93?3?3@W63AY9Y93A3BY9Y9Y9W(Y93AW(W(W(W(W(3AW(3AVUVU3AY9W(W(3A3BVUVU3BVUVUVU3B3CVUVUWQVUWQWQX#X#3BX#3BX#VU3CX#X#3CX#3CX#X#X#VU3C3D3E3EX#3FX#3FX#VU3GVUVUVU3G3GX#3H3IVSX#X#X#3HVSX#X#VSVSVS3HVSVS3HVS3HVSX#VSX#X#X#W7VSVSW7W73F3GW7W7W73GW7W7W7W7X#3GW,3GW7W73GW7W7W7W7W7W73GW7W73G3HW7W93HW9W7W9W9W9W73GW7W7W73G3H3I3IW9W9W9W93IW93J3JW<3KW<W93KW9W9W93K3L3MW93MW93N3NW<W<W<W<W<3NW<WTWTWT3NWTY%X%Y%TMTMULULUU3LUUUUULUEUL3LTM3LTMUL3LULULULUE3LULUEUETLUE3LTLTLUE3LULUL3LUL3L3MUEUEUIULUI3M3MTLUEUETL3MXNUPT&S9T&3MS9S9S93M3MWQWQWQW@3MW@W@W@W@WQ3MWQWQWQ3MWQ3MWQWQVVWN3MWNWNWNWQWNWNWNW+W+X#X#WEX#X#3JW+3KW+W+W+WE3J3KWEWEWEX#3KX#3KXXWEWE3KW7X#3LX#3LX#X#W9W9W9W<W9W9W93KW9W<W<W<3JW<W<W<W<W<3JW:3JW:W<W<W<W:W<W<3I3JW<W<W:3JW:W:W:W:3JW:W<W<3JW<X$X$W<W<W<W<W<3IW)W)3I3J3JW<W)W)3J3K3LW)3L3MW<W)X$X$W<W<W<W<W<X-W)3KW)W)3KW<W)W<W)W)3KW<W)W<W)W)X-WUWUWU3IWUX-X-WUWUVXVXWUWUWU3HWUWU3HWUWUWU3HWUWUWXWXWXWXY$WXX%UFUFT>3FUFUFUIUIUI3EUIUIUH3EUH3FUHUH3FTHTH3FTHTAV%3FV%V5T+T+T+3FV3T,3FT,XFSASA3FSZSZ3FS=S9S9SHSH3EWQVMVMWQWQVMVM3DX-W)X-X-3DVXVXVXVXX-VXX*X*3C3DVX3DVXVXVX3DVXVXVXVXX*VXW0W0X*W03B3CWUWUUI3CUIU*TYV7TYV7V7V7V7UAT:T:3AT:3ATQTITITDTDTD3A3AV#TITIS=S=3AS4S=3A3B3CS=S=S=3CS<S<XFSBSBSBSBSVS-T#S-S-T#3@S.S.3@S.S.S.T#SYT#T#SYSYSKSKSYSKSKSKSMT#SM3=SMT$SMT$SYSKSKSKSK3;SKS@SKS@SKS@3:S@S@S@SKS@SKS@39SXSXSXSXSX39SX39SXSXSXS1S1S/S/S1S1S/S/S1S1S?S?S?S?36SUW<W<W<W'35VXVXVXVXVXWKWKVXWKVXWKX-VXX-VXTITITD3232S-S-S-S-S-S-S.S-S-S-S.S.30S.31SMSMSM31S.31S.S.313233SMT$T$T$33T$33T$XESKSKXRSQS@S@SQS@S331S3S3S3S331S331SOSOSOSOSOSO3131SG32SGSOSO32SGSGSWSWSW3132SGSWW>VXW>W>W>W>W431W431W4W4W>31W432W?W?WLW?W?31W?W?Y$W?W$31W?W?WCWCU+U+U=U+U+U+U+U=U#U#3.U#U#U#U#3.S7S7S73.S73.XRSNSNSJ3.SJ3.SJSJSJ3.SJSNSN3.SJSNSNS7S73.SJSOSGSO3.SO3.3/SISOSOSO3/SISISI3/S8S83/S8SOS>SOS>3.S>SISISI3.3/3030SWSWSWS>30S>S>30SWS>SWSWSW30SW30S>S>S>30WCWCWCUB30V$V$V$V$V$30V.30V.V.V(V(T=30V(V(30U@T=30T=T=30U@T=U@T=U@T=T=V(U#3/V(3/U#V(V(V(V(3/V(V(V(V(U@3.V(U@U@SN3.SNSOSOSO3.SOSP3.SPSP3.SO3/30S>S>SP30SPS6S6S6SPSPSP3/S6S6S63/SR3/SR30S630SRSRW4WCW4WCU=U=U=3/U=V,V,V,V,U<V,V,U<U<3-T5U<U<T5T53,TGTGTGTGTGTG3,TPTP3,V.TGV.3,V.TG3,TGV.V.T=T=T=SNSNT(T(SD3*SCSDSCSDSCSDSDSDSE3)S6S63)SRSD3)SDSDSDSD3)SDT53)T5T5T5T;T53)T/3)T/T/T83)T8T0T/T/T2T/T/T03(3)T0T0T03)T;T;3)T;3)3*T;T;T;3*T;TGT;3*T;T0T03*3+V.3+T0T0T0T0T0V.V.T0V.3*V.SC3*3+SESCSESESESCSCSC3*SESESE3*3*SSSSSSSESESSSSSESE3)ST3)XDXDXDXD3)XDXDT3T6T3T3T53(T53)T3T33)3*3*3+T73,T7T0T7T0T0T0T03+T0T0T5T5T0T03*T.T0T.T5T.T03)T.T.T5T.T5T.T03(3)UMUM3)UMUM3)UM3*UMT03*T03+T0T03+T0T03+T0UM3+UMUMUMV.V.V.3+V.V.UMUMUMV.UMUMV.V.3)V.3)UMT.T.UMUM3)UMUMUMT.T.3(SSSESEXCX:X?X:X:3'X:XDXD3'XBXBX:XB3'XBXDXD3'XBXDXDXBXBXD3&XB3'V,T5V,T5V,T5V,T5T5T5V,T5T5T.T53$3$XBX:XBV,V,V,T/T43#T4T43#T4T4T4T43#T4T4Y7Y73#3$Y7Y73$Y73$Y7Y7Y7YHYH3$YGYHYH3$3%YHYUYUYUY7Y7YGYGYGY=Y=Y=2Z3#X.X&3#3$X&X&3$X.X&X&Y43$3%Y@Y4Y43%Y@Y@Y@3%Y@Y@Y43%Y4Y43%Y4Y4Y'3%Y'Y'3%Y,3&Y,Y'Y'Y'3&3&Y,3'Y,YH3'YUYUYHYH3'YHY3Y3Y,Y,Y3Y3Y,3&Y,3&Y,Y,3&Y,Y,Y,Y3Y3Y,Y,Y33%Y3Y33%YUYUYUY,Z&Y,Z&Y,3$3%3&3&Z&Y,Y,Z&Z&3&Z&YLYL3&3'YLZ$Z$Z$YLYL3&YLYVYV3&3'YV3'YVYG3'YGYGYGZ&Z$Z&Z&Z&YEZ&YEZ&YEZ&Z&Z$Z$YEYEYEZ$YEYEYE2ZYEYE2Z3#YGYGY=YGY=Y=Y=Y=YNYNYNYN2YYN2YYGYXYXYGYGYXYXYG2XYGYGYXYNYX2XYNYN2XYNYG2XYGYG2XYNYGYGYNYN2XYGYGYGYNYNYGYGYG2WYXYNYNYNYN2VYNYNYN2V2WX.Y=Y=YNYNYN2VYNYG2VYNYNYNYNYN2VX.2VX.YNYNX.X.2VX.YNYGYGYGYN2UX.X.2UX.X.X.YGYGYG2U2UX.2VX.2VYGX.2WX.X.2WX.WIWIVNWIX.X.2V2WX.X&X&X&WHWHWHVYVYVYVNVYWHWGWHWHWGWGVYWG2RW=W=W=WGWGVYWG2QW=W3W3W=W32QW3V=2QV=U>2Q2RU>U>2RV=U>U>U>U>2RU>2RV=U>U>V=V=U>U>2QTETETETLTLTTTTUT2PUTUTTLTLUTTLV?2OTLTLTLTUTL2OV;V;2O2PTUTUUGTUTL2OTLTLUG2OTLTL2OUGTLUGTLTLTL2OUGTU2OTLV;V;TU2OV;V;2OV;UKUK2OUKUPUK2OUKUPUKUP2O2OU$U$U$Y6YIY6YIY6Y6Y62NY:Y:YIYIY@2MY@YIY.Y.2MY.2MY.YI2NY.2NY.Y.2NY'2O2PY.Y.2P2Q2Q2RYI2SY'Y'2S2T2T2UY.Y.2U2VY.Y.Y'Y'2V2WY'2WY'2X2X2Y2ZY,2Z3#Y'3$3$Y,3%Y,3%Y,Y,Y,Y'Y'3%3&3&Y,3'Y,3'3(3)3*Y,Y,3*Y,Y.Y.3*3+Y.Y.YIYI3*Y.YI3+Y.YA3+3,Y,Y,YAY,3+3,YIYI3,3-YIYIY,Y,3-Y,3-3.YIYI3.YIYIYIYIYIYI3.YIYIZ)YIYIZ)Z)3-YI3-YI3.3.YI3/YIZ)Z)3/Z)YIZ)YI3/YI3/YI3030YM31YMYIYI3132YMYM32YM3233YIYI33Y,343535Z&36Z&36Z&37Z&Y,Y,3738Y,Y,Y,38Y,3839YK393:YKYKY,Y,Y,YKY,39YKYK39YKY,YK39YKYKYKYI39YI3:3:Y,3;Y,3;3<3=3>3>3?3@Z)3@3AZ)Z)3A3BZ)Z)3BY,3C3DY,Y,Z#Y,3CZ#Z)Z)Y,Y,Y,Z#Z#Z#Z#3B3BYM3CYMZ)Z)YM3CZ)YM3CYM3CYMYMYMZ)Z)3C3D3DYMYMYM3D3EYMYMZ)YM3EYM3E3FY,3GY,Y,Y,3GY,Y,Z#Z#Z#Z#Z#YMZ#Z#YMYMY,3DZ#Z#Y,3D3EZ#YKYKZ#Z#YKZ#Z#Z#YMZ#YMYMZ#Z#YMYMZ#Z#YMYMZ#Z#3@3AYMY?YM3AY?Y?3AY?Z#Z#3AZ#Z#Z#Z#Y?YM3@3A3B3BY?3C3DYKZ&YKYKZ&Z&3CZ&YKYKZ#YKYKYK3BYKYKYK3B3CZ&Z&YKYK3B3CYKYK3CZ&3D3EYKYK3E3FYKYK3FY-YKYKY-Y-YK3EY-Y-Z&Z&Y-Y-3DZ&Y-Y-Z&Z&Y-Y-Z&Z&Y-Y-Z&Z&Y-Y-Z#3AZ#Z#3A3BZ#Y0Z#Z#Z#3B3BY03CY03CY-Y-Y-3CY-3D3EY-Y-3EY-Y03EY0Y03E3FY0Y03F3GY0Y03GZ#Y?Y?3G3HY?3I3IY03JY0Y?Y?Y?Z'3IZ'Z'Z'Z'Z'YPZ'Z'Z'YPYPY0Y03GY0Z'Z'YPZ'Y0Z'Z'Z'Z'Z'3E3FZ'Z'Z'3FY-Y-3FY03FY0Y0Y0Y-Y-Y-3F3FY0Y0Y03FY0Y0Y0Y-Y-Y0Y0Y-Y-Y0Y0Y-Y-3D3E3E3F3G3HY03H3IY/Y0Y0Y03IY03IY03J3JY0Y+Y+Y03J3K3LZ'Y+Z'Y+Z'Y+Z'3KY0Y03KY/3KY/Y/Y/Y/Y/Y+3KZ&YEZ&3KYEYE3KYEZ&Y<Z&Y<Y<Y<Z&Y<YE3IY<Y<Z&Z&Z&3IZ&Z&Z&Y<YYYYY03HYYYYY/3HYYYY3HYYY<Y<Y/Y/Y<Y<3GY<3GY2Y/Y/3GY<Y2Y2Y<Y<Y23G3GY<3HY<Y<Y<3HY<Y23HY2Y2Y23HY23IY2Y23IY23IY<Y/Y/3I3J3KY/3KY/Y/Y/YEY<Y<Y<3JYEY<Y<YEY<Y<Y<Y<YGY<Y<YGYGY<Y<3GYG3HY<YGYGYG3HY<Y<Y<3HY<Y<Y<Z(Y<Y<Z(Z(Y<Y<3F3GY<Z(3GZ(Y<Y<YRYRYGY<Y<Y<Y<YGY<3EYG3EZ%Z%YGYG3EYGYQYQZ%YQ3D3EYQYQ3EYQYQYQ3EZ%Z%Z%Y<Y<Y<YG3D3EYGYGYGYG3EYGY<Y<Y<3E3EYGYGYGYG3EZ%Z%YGZ%YGYGZ%Z%YGYGYG3CYQYQZ%YQZ%YQYQYQYQZ%YQYQ3AYQZ%Z%WJWJ3@X.X.X.Z%Z%Y)Y)3?3@Y)Y)WJ3@WJWJX.X.3@X.VTVTVT3@VTVT3@VQVT3@VQVQ3@VQVQVQ3@X(3AX(W3W33AX'W3W33AX'W3W%W%W%3@3AWUWU3AWUWUWUW%W%W%WUWUX,WU3@X,X,3@X,WUWUWU3@U>TTU>3@U>3@U>TTTETETTTTTTTLTLTLTUTUTU3>TUTUTU3>3>U0U1U0TUTU3>3?TUTUTU3?TUV;3?V;TUTU3?3@TU3@3AUP3AU0TLU03AU03BU03BU53CU5TLU3TLTLU5U5TL3BTL3BTLTLUPUP3BUP3BUPUPUPU9U9U93B3B3C3D3EV;UP3EUP3EV;3FV;3F3G3H3IV;V;3I3J3JUPUPUPYB3J3KY>YBYBY>3KYBYB3KY>YBYBY>Y>Y>3JY>3K3KYI3LYBYBYIYBYBY>YBY>YBY>YBY>YBYBYBY>YBYBYB3HYB3H3IYBYB3IYI3JYBYIYI3JYB3J3KYBYBYIYBYBYB3J3KYIYIYIYMYIYIYMYM3JYMYIYIYI3JYMYM3JYM3JYM3KYMYIYIYI3KYIYMYIYI3J3KYMYMZ'YPZ'Z'Z'YPZ'3JYPYP3JYPZ'3JZ'Z'YPYP3J3KYPYJYPYJZ'3JZ'Z'3JYJZ'YJZ'3JYP3K3KY+3LY+YP3LYPYPY+Y+YPY+Y+3KY+3LYJYJ3LYWY+Y+3LY+Y+Y+3L3M3MYW3NYWYW3NYWYWY+Y+3NYSY+3NYSYS3NYSYSYSYSYSYWYSYSYS3M3NYSYSY*Y*Y/Y/3MY/YT3MYTYT3MY/YTYTYTYTY+Y+Y/Y/YT3LY/Y/3LY/3L3M3NYTYTYTY*Y*Y/Y/Y/3MY/Y/3MY/YT3MYTYTYTY/YTYTY/Y/YT3LY/Y/3LY/YTYTYT3LY*3LY*3MY*3MY*Y*Y9Y9Y*Y93LWZWZWZWZX/3LX/Y9X/X/X/X/X/Y93KX/X/3K3LX/X/3LX/Y9Y9Y93LX#X#Y9X#WZWZWZVWVWYGVW3JYGYGYGVWX/X/3IVW3IVWX#X#3IVWX#X#VWVW3IVWX/X/VWX/3HVWX/X#VWX#X#X#VWVW3GVWVWVW3GVWWSWSVS3GWSWS3GWSVSVSX#X#VSVS3FVSWSWS3FWSVSWSVS3F3FWSVSWSVS3FVSVSWS3FWS3GWSWSVS3GWSWS3GWSVS3GVSVS3GWSVSVSVNVNWP3G3GVNVNVNVNVN3G3H3HWY3IWYVNVN3I3JW#W#3J3KW#W#3KW#3K3LW#W#VNVN3L3M3MWYWYWYVNWYWYWY3L3MW,W,WYWY3M3N3N3OWYWY3O3PW,W,WYW,3PW,WYWYWY3PW,3PW,W,3PW,W,W,WYWY3P3QWY3QWYWYW,3Q3R3S3SWYWY3T3T3UW#W#3UW,W#W#W#W#W,W,W,3T3U3V3V3WW#3XW,W,3XW,WSW,3XW,3XW,WSWSW,W,3XW,3XWYWYWY3X3YWYWYWYWY3YWYWYWYWY3Y3YW#WY3ZW#W#3Z4#4#4$4%W#4%4&W#W#W#4&W#W#4&4'W#W#VNVN4'4(VNVN4(4)WUWUWU4)WUWUWUWM4(4)4*WMWU4*WUWM4*WMWMWMWM4*WTWTWMWMWM4*4*4+WTWT4+WTWTWTWU4+WUWUWUWM4+WM4+WUWMWMWUWU4+X+WMWMWM4+WT4+WTWT4+WTWTWT4+UYU>UYU>UYU>4+4+4,U>UYUYUYU>UYU>U>V:V:U>U>4*4+U>U>V:V:4*4+V:V:4+4,4-UY4-TTTTTTUYTTUYTT4,TTUYTT4,U/U/U/4,U/U/U/UU4,UUUU4,TT4-TT4-TLTLTLTL4-TLTLTL4-TLU:4-UPU:UPTL4-TLUPTLUP4-UPUPUP4-UPUPUP4-4.TLUP4.UP4.UPTLUPYBYB4.YBYBYBS:S:YBYBYB4-YB4-S:S:S:S:S:4-4-4.S:4/S0S04/S04/S0S:S0S0T'S0S0S0T'S0T'S0S0S0T'S0T'T'T'T'T&T'T&4*Y9Y9Y9Y9Y94*Y9Y*4*Y*Y*Y*Y9Y*XVY9Y9Y94)W-W-4)W-4)4*WFWFY9Y9W(W(Y9Y94)Y9Y9Y9Y94)W(4)W(W(Y9W(W(W(W(W(4(W(4(WFWFWFVZ4(VZVZ4(4)VZVZVZVZVZ4)VZVZ4)W(W6VZW6W6VZ4(W6W6W6W6W64(W6W64(4)W64)W64*VZ4*4+W(4+W(W6W(4+4,VO4-W(W(4-W(W6W6W.4-4-W6W6W6W6W6W6W/4,W/W/VOW6VOW64,Y9Y9W(W(4+Y9W(W(Y9Y9Y94+W(4+W(W(W(VU4+VUY9Y94+Y9Y9Y9W(4+Y9Y9VUVU4*VUVUVUY9Y9VU4*Y9Y94*VUX#X#4*X#VUX#VU4*X#X#VUVUX#X#VUX#4(X#VUX#4(X#X#X#VU4(VU4)4)X#4*X#X#X#VUX#4)X#VUVUX#X#VU4)VUX#VUVUVUX#VUVUVUX#VUX#VU4&4'VU4'X#4(X#X#VSX#X#VSVS4'4(VSVS4(4)4)4*X#VSVSVSVSW7VSVSW7W74(WS4)4*X#W7X#X#4)W,4*4+4+W7W7W7W7W74+W9W7W7W9W9W74*W9W9W9W9W7W9W7W7W74)4)4*W7W74*4+4,W9W7W9W9W94+W9W9W9W94+W9W9W94+W9W9W<W<4+W<W<W<W9W<4*W<4+W9W<W<4+W<W9W9W94+W<W<4+W<W9W9W94+W94+W9W<W9W<W<W<W9W<W<W<WTWTWTX%TLTL4(TLUEUEULUETMTMTM4'TM4'TM4(UETLUE4(UE4(UEUETLTL4(TLULUL4(UI4(4)UEUETLTLUE4)UIULUIULTLTL4(UETL4(UPUPS9S9T&S9S94'S9WQ4'WQWQWQ4'4(W@VU4(WQWQWQWQVV4(VV4(VVWQVVVVWNWNWNW+WEW+4'W+4'W+W+W+4'W+WE4'WEWEWE4'W+W+W+4'W+4(WEW7W74(W9W9W94(W94(W9X#W9W9W9W94(W9W<4(W<W<W<W<4(W<4(W<W<W<4(W<W<4(W:W<W:4(WUW:W:W:W:4(W<W<4(W<W)W<4(W<W<W<4(W<W<W)W)W<W)W)W<W)W)W<W<4&W)4&4'W)W)W)W)4'W)W<4'W<W<4'W)W<W)W<W<W)W)W<W<W)W)4%4&4'4(X-WUX-4(WUWU4(4)WUWU4)WUWUWU4)4*UFUF4*UIULUL4*UIUHTH4*TH4*THTHTHUHTHTHTHTHTHTA4)V5V<V54)4)4*4+4,V3V3V3T,SA4+SASZSZSZS=4+WQWQ4+WQW)W)W)X-4*X*VXVXX*X*VX4*X*X*4*VXX*X*4*4+VXX*4+X*WU4+4,WU4,W14-4.4.U*UIU*T:T:TI4.TQTQTITI4-TITDTIV#V#TITIS4S4S44,S=S=4,S4S44,S=S=S4S=S=S=S=S=S5S54*4+S.S.S-S.4+S.SMT$SMT$S@4*S@S@SKS@SKS@4)SXSXSXS@SX4)SXS@4)SXS@4)SUSUSUX-VXX-VXTDTDTD4(S-S-SVS-S.SM4'SM4'SM4(SMSMT$SMT$S.SMS.S.SMSM4&4'SM4'4(4)S.SMS.S.T$T$T$4(T$4(T$T$S3S3S34(S3S3S34(SFSFSOSFSO4'SOSGSGSG4'SG4'SGSOSGSOSOSOSGSGSGSG4&4&SW4'SWW>W>W4W4W>W>W4W>W>W>4%4&4&4'W4W4W?W$W?W?W$W?4&W$U#U#T-4&U#U#V(U#S7S7SNS7S7S7S7SNSNSJSNSJSJ3ZSJSJ3ZSJ4#4$SJSJSNSN4#4$4%SJ4%SG4&SGSGSGSG4&SO4&4'SISO4'SO4(SI4(SISI4(S8SOS8SGSG4(SISISISI4(4(S8S84)S>4)S>S>SGSWSGSWSWSWS>4(SWSW4(SW4(SWS>SWSWS>S>S>WLWC4'WCUBV$V$V$V$4&V$TPV.T-V.V.V(V(4%4&V(V(4&4'4'4(T=T=T=4(T=T=V(U#V(V(U#U#U#4'V(V(U@4'V(V(4'V(SNSOSNSO4&SOSPSO4&SOSPSPSOSOSPSOSPSPSP4%SOSOSPSOS>S>SP4$SP4$SPSPS6S64$S64$S6SR4%SR4%SRSRS6S64%S6U=4%V,V,4%T1T1T5U<U<U<4%TGTG4%TGTPTPTP4%TGTGV.V.TG4$TGV.4$SPSDSDSESDSESES64#SRS6SD4#SDSDSDSD4#SE4#T1T5T5T04#T0T0T8T8T/T8T8T0T8T0T/3YT/T/3YT0T/T0T0T0T03YT;T;T03YT03YT0T03YT;T;T;3YTGT;TG3Y3ZT;4#4#V.V.V.4#V.V.V.T;4#T0T04#V.V.V.SCSC4#SESCSCSC4#SCSESESESESE3Z4#SE4#SE4$SESTSTSTX;X;X;XD3Z4#XDXDT3T34#T34#4$T5T54$T3T54%T3T34%T3T74%T7T7T0T04%T0T7T0T7T04$4%T.T.4%T0T.T.T04%T.T.4%V.4&UMT0UMT0UMV.V.4%4&T0UM4&UM4&UMUMUMT0T0T04&T04&T0T04&T0T.4'T0T0T0UMUMUM4&UMV.V.4&4'V.V.4'V.T0T0T.T.4&UMT.UM4&SSSESSX<X<XDX<XDXD4%XDX:XBX:XBXB4$XBXBXDXD4$4%4%XBXBXBT54%T5T5X:XBX:XB4$4%T4T44%4&T4T4T44&T4T4YU4&YUYU4&4'YU4(Y7Y74(Y74(4)Y7Y7YHYGYGYGYHYHYGYGYHYHYGYGX.4&X.X.4&X.X&X&X.X.4&4'X.X.X&X&X.X.X&4&Y44&Y@Y@Y44&Y@Y@Y44&Y@Y@Y@Y@4&Y@Y44&Y4Y4Y@Y@4&Y@Y'4&Y'Y'Y,Y,Y'Y,Y'Y,Y'Y,4$Y'Y,Y,Y'Y,4$Y,4$Y,Y,Y,YHYUYUYUYHYH4#4$Y3Y3Y34$Y,4$Y,Y,4$Y,Y,Y,4$YUY34%Y3YUY3Y3Y,Z&Y,Z&Y,Y,Y,4#4#Z&4$Z&4$Z&Y,Y,Z&Z&4$Z&4$4%Z$Z$YLYLZ$Z$YLYLZ$Z$YL4#YLYL4#YV4$YVYVYGYVYVYGYG4#YGYEYGYEYEY=Y=YGYGY=Y=YGYGY=YNY=Y=YGYGYGYXYXYXYGYXYXYNYXYXYNYN3TYNYGY=YGYGY=Y=YGYGYNYGYGYGYGYGYGYNYXYNYNYNYNX.3OX.YN3OYNX.YNYNYN3OYNYN3O3PYNYN3P3Q3QX.YNYNX.X.3QX.3QX.X.X.YG3QYGYGYG3QYG3RYGYG3RX.3RX.X.X.3R3SYGYG3SYGX.X.3SX.WOWOX.3SX.X.3S3TX&X&3T3UW=W=W=W=W=3U3UW3W3W3V=V=V=3UV=V=3UV=V=V=V=3UV=V=3UV=V=U>V=U>V=V=3T3UU>TETETEUT3TUTUTV?V?3T3UUGUG3UUGV;V9V;3UV93U3VV;UGUGTLTLTUTUUGUG3TUG3UTLTL3UTLTL3UTU3VTLV;V;TUTUV;V;3UTUUKUK3U3VUPUPUP3VUK3VUPUPU-U$U$U$Y6Y6Y6Y:Y@Y@Y@YIYIY.YI3SYI3SYIYIYIY.YIYIY.Y'Y.Y.Y'Y'3QY'Y.Y'Y.Y.3PY.Y.Y.Y.3P3Q3R3R3SYI3TY.3TYIYIY.Y.3T3UYI3UYIYI3UY'Y.Y.3U3VY.Y.Y'Y'3V3W3WY'Y.Y.3WY'Y.3XY'Y'3X3Y3Y3ZY.Y.3Z4#Y.Y.Y'Y'Y'4#4#4$Y'4%Y'Y'4%4&Y'Y'4&Y,Y,Y,4&Y,Y'4&Y'Y'Y'4&Y'Y'4&4'4(Y,4(Y,Y,Y,4(Y,Y,Y,Y'4(4)4*Y'Y'4*4+Y'4+Y'4,4,4-4.4/4/Y,40Y,Y.40414242Y,Y'434344Y.Y.Y'44Y.Y.Y,Y,44Y,YI44YIYI4445YIYI4546YIY.Y.Y.YIYIY.YAY.45YAYA45YAY.45464747YA4849YAYA49YA49Y,4:Y,Y,Y,4:4;YI4;YIYI4;4<YIYI4<Y,YIYIYIYIYIZ)Z)Z)Z)4;YIYIYI4;YI4;YIYI4;4<4=4>4>YIYIYIZ)Z)4>4?Z)Z)YIYIYI4>YMYMYIYMYI4>4>YMYMYMYMYM4>YMYI4>4?YMYIYMYMYM4>YMYMYMY,Y,YIYIY,Y,YI4=Y,Y,4=Y,YI4=4>4?4?Y,Y,Y,4?Z&4@Z&Y,4@Y,4AY,4A4BZ&Y,4BY,Y,Y,Y,YKYKY,YK4AYKY,Y,Y,4A4A4BYKYK4BYKYKYK4BY,4CY,Y,4C4D4EY,Y,Y,YKYKYKY,Y,Y,YKYKYK4B4C4DY,4DY,Y,Y,YIY,4DY,4DY,4EY,4EY,4F4GY,Y,4GY,4G4HZ)Z)4H4IZ)Z)Y,Y,Y,4IY,Y,4IY,4IZ)Z)Z)Z)4IZ)4J4J4KZ)4LY,Y,4LZ)Y,Y,4LZ)Y,Y,4LY,Z)4LZ)Z)4LZ#4MZ#Z)4MZ)4NZ#Z#4NYMZ)Z)Z)YM4MYMYMYM4M4NYMZ)Z)4N4OYM4O4PYMYMZ)4PZ)Z)4PYMYMYM4PZ)YMYMYMZ)YMYMYMYM4OYM4O4PYMYMY,4PY,4Q4Q4RZ#Z#Z#Z#4RZ#Y,Z#Z#Z#4QZ#Y,Y,Y,Y,4Q4RY,Y,Y,4RZ#Z#YMY?Z#Z#Y?4QYM4QYM4RY?Y?4RY?Z#Z#4RZ#YM4RYMYMYMYMYMZ'YMYMZ'4Q4QY?4R4SYM4SY?Y?4SY?Y?Y?Z&Z&YKYKYKYK4RYKYKYK4R4SYKYK4SYKZ&Z&4S4TZ&Z&YK4TZ&Z&4T4UYK4UYKYK4UZ&4V4WYKYKYK4W4WYK4X4YYKYKY-Y-YKY-4XY-Z&Z&Y-Y-Z#4WZ#Z#4W4X4Y4Z4ZZ#Y0Y0Z#4Z5#Y0Z#Y0Y0Y0Z#Y0Y0Y04YY-Z#Y-4YY-Z#4ZZ#4ZZ#5#5#5$Y0Y0Y-Y-Y05$5$5%Y0Y0Y-5%Y0Y05%5&Y0Y05&5'Y0Y05'5(Y0Y0Z#Z#Z#5(Z#Y?5(Y?Y?Y0Y?Y?Y?Y?Y?Z'Y0Y05&Y05&Y0Z'Z'Y?5&Z'Z'Y0Y05&Y0Z'5&Z'YP5&Z'YPYPZ'Z'YP5&Y0Y05&Y0Y-Y-5&Y-Y-Y0Y0Y0Y-Y-5%Y05%5&Y0Y0Y0Y-Y0Y0Y-Y-Y0Y0Y-5$Y-5%5%YYYYYY5%5&5'Y0YYYY5'YYY0Y/5'Y/Y05'Y0Y/Y0Y0Y0Y+Y0Y0Y05&5&Y+Y+Y+Y0Y05&Y0Y0Y05&Y0Y+Y/Y+5&Y/Y/5&Y/Z'Z'Z'Y+Y05%Y0Y0Y0Y/Y/Y/Y+Y/5$Y/Z&YEZ&Z&YEYEZ&5#YEYE5#5$Z&Z&Z&Y<Y0YY5#Y/Y/5#Y/Y/5#YYY/Y/5#5$Y2Y2Y2Y2Y/5$Y25$Y25%Y2Y<Y2Y2Y2Y<Y2Y<Y2Y<Y2Y2Y2Y<4Z5#Y25#Y2Y2Y25#Y25$Y25$Y2Y2Y2Y2Y25$Y/5$Y/Y/Y<Y<Y<5$Y<Y<5$Y/Y/5$Y/Y/Y<5$Y/Y/YEYEY<Y<YGYG5#YGY<5#Y<Y<5#5$Y<Y<Y<YRYRYR5#5$Z(Z(5$5%Z(Z(5%Z(Z(Z(5%YGY<YGYGYGZ%Z%YGYG5$YGYGYGYQYQYGYGYQYQYGYGYQYG4YZ%Z%Z%Y<Y<YGYGY<YGYGYG4WYG4X4YY<Y<Y<4YY<YG4YYGYGYG4YYGYGYGYQYQYQYQ4XYQYNX.X.X.Z%Z%Y)Y)4VY)Y)Y)X.4VWJWJX.X.X.4VVTVT4V4WVTVTVQVQVTVTVQ4VVTVT4VVQX(X(4VX(4VX(X(X(X'4VX'X'4VX'X'X'WU4VWUWU4V4WWUWUW%W%4W4XWUX,WU4XX,X,4XX,WUX+X+X+U>TT4WTT4WTTU>TTTUTU4WTUTUTUTU4WTL4WTLTLTUTU4WTUTUTU4WTUTU4W4XV;4X4YV;V;TUTUTU4YTUTU4Y4Z4ZV;TUV;TUTU4ZUPTLU0TLU0TLU0TLU0TLU0TLU0TLU5TL4W4WU5U5TLTLU4TL4WTL4WTLTLUPUP4WUP4WUPUPUPU9U9U9UPU94VU9U9UPUP4VUPU9U9UPUPU9UPUPUPV;UPV;4T4TV;4UV;4UV;4VV;V;4VV;V;UPUP4VUPV;V;UPUP4UUPUPUPV;V;V;4UV;V;4UUP4UUPUPUPYBYB4UY>4UY>Y>Y>YBYBY>Y>YBYBY>Y>YBYB4SYB4SYBYBYBYBYI4SYI4S4TYBYBYBYB4TYBY(4TY(Y(4TYIYBYBYIYI4T4U4UYIYBYBYBYIYBYBYIYI4T4UYIYI4U4VYI4VYIYIYMYMYIYIYM4UYIYIYI4UYIYIYMYMYIYIYIYM4TYM4TYMYIYMYIYIYIYMYM4SYM4T4TYM4UYMYPYPZ'YPYPYPZ'YP4SYPZ'YPZ'YPZ'Z'YPYP4RYPZ'4RZ'Z'Z'YPZ'4RZ'Y+YPYPYPYPYP4QY+Y+YPY+4PY+Y+Y+YP4PYPY+Y+Y+Y+YTY+YTY+Y+YJYJYJYWYJY+Y+Y+YWY+YWYWY+Y+YWY+YJYWYJYWYJYWYJYWYWYS4H4IY+Y+YS4IY+YSYSYSYSY+YSYSYSYSY*Y*YSYSY*Y*4EY/4F4GYT4GYTY/4GY/Y/Y/Y/Y/YT4GY/Y/4GY/Y/Y/Y/4GY/Y/4GYTY/4GYTYTY/Y/Y/4GY/Y/4GY/YT4GYTYTY/Y/YTYTY/Y/YTYTYTY9Y9Y94DY94EY9Y*Y9Y9Y9Y*4DY*4EYGYGYG4EX/X/Y9X/Y94DY9Y94DY9Y9Y9Y9X/Y9Y9X/X/4CX/Y9X#4C4DVWYGVWVWVWVW4CVWVWVW4C4D4DVWX#X#VWVW4D4EX/VW4EVWVWVWX#X#VWVW4DVW4DWSVSVSWSWSVSVSVSVS4CVS4CWS4DWSWSWSVSWS4CWSVSWSVSWSVS4CWSWSWSWYWS4BWSWSWSWSVSVSWSWSVS4AVS4AVS4BWSWS4BWSVNVN4B4CWPVNVNVNVN4BVN4C4C4DWYWYVNVNVN4D4DWYWYWYVNVNW#W#VNVNW#W#W#W#W#4BW#W#4B4CW#W#WY4CW#4CW#W#VNVN4C4DVNWYVNWY4CWYWYWY4CWYWYWYWYWYWY4CWYWY4CWY4C4DW,W,4D4EW,W,WYWY4E4FWY4FW,W,4F4GW,W,4G4HW,W,WYW,W,W,WYWYWYW,WY4FW,W,4FW,W,W,WYW,W,W,WYWYW,WY4D4EWYWYW,4E4F4GW,WY4G4HWYWY4HWY4HWYWYWYWYWY4H4IW,W,W,4IW,W,4I4JW,W,W#W#WYWY4I4JW#4JW#W#4JW#W#W#4JWY4KW#4KW#4LW#4L4M4N4OW,W,WSWSWSW,WSW,4M4NWSWSW,W,W,4NW#4NWYWYWY4NWYWYW#4N4O4PWYWY4PWYWY4P4QW#W#W#W#4Q4Q4RWYWYW#W#4R4SW#W#4S4TWYWYWY4TWYWY4TWY4TWYW#W#4T4U4V4W4W4XW#W#4X4YW#4ZWY4Z5#W#5#W#W#W#W#5#W#W#5#W#W#W#W#5#W#W#5#W#W#W#WUWU5#5$WUWUWU5$WUWM5$WMWU5$WMWMWU5$WUWMWUWU5$WMWMWMWT5$WM5$WTWTWM5$5%5&WMWMWTWTWMWT5%5&WUX+WU5&WU5&WMWMWUWU5&WMWUWUWUX+WMWT5%WTWM5%WTWTWM5%5&WTU>UYU>UYUYUY5%UYU>5%U>U>5%UYUYUY5%5&V:V:5&V:V:V:U>U>V:5&U>U>5&5'U>5'V:UY5'UYUYUY5'UYU/U/5'5(5)5*UYTTUYTT5)5*U/U/5*5+U/U/5+5,UU5-TTTT5-TT5-TTUUUU5-TLTTTLUPUPTLUPTLTLU:U:U:UPU:U:TL5*UPUPTLUPUPUPTLUP5)UPTLUPTLTLUPUP5(UPTLTLTL5(TL5(TLTL5(YBY>YBYBYB5(YBYBS:5(S:5(S:S:S:S:S0S:5(S0S05(S0S:S0S:S:S0S05'S05'S0S:S0Y9Y9Y*Y*Y9Y9Y*Y*Y*Y9Y*Y*Y9Y9Y9Y*W-W-5#5$WF5$WFWFW-W-WFWFY9Y95#W(Y95#W(W(Y9Y9W(Y94ZW(W(W(W-4ZWFWF4Z5#VZVZ5#5$VZVZ5$5%VZW(VZVZVZ5%VZVZ5%W(VZ5%VZW6W6W6W6W/5$5%W/W/W6W6W6VOW6W/5$W/W6W/W6W6VZW(VZW(VZVZ4Z5#W65#W6W6W6W(VOVOW(W(VO4ZVO4ZVOVO4Z5#VOVO5#W65$W6W.5$S9W6W6W/5$W/5$VO5%VOY9Y9Y9W(Y9Y9W(5$W(W(W(5$W(5$VUVUY9Y95$Y9Y95$VUVUW(VUW(VUVU5#VUVU5#VUVUVU5#X#5$X#X#X#VUX#VUX#VUX#VUVU4Z5#VUVUVU5#VU5#VUVUVUX#5#X#5#X#VUX#VUVUVU5#5#5$VUVU5$5%VU5&VUVU5&VUX#X#5&X#VUX#VU5&VSVSX#5&VSVS5&X#VSVSX#5&VSVS5&VSX#5&X#X#5&VSVSVSWSWSW7WSW75%W7W75%W7W7W7W,W,5%W,W75%W7W75%W,5&W7W7W75&W75&W95'W95'W95(W9W7W9W7W9W75'W7W75'W9W7W9W7W7W75'W7W7W75'W75'5(5)5)W95*W9W9W<W95*W95*W9W9W9W<5*W<W9W<W9W<W9W<W9W95(W<W9W<W95(W95)W<W<5)W<W9W95)5*5*W<W9W<TLTL5*5+TMTMULTMULUL5*UL5*ULTMUL5*TL5+TL5+TL5,5-TLTLUETLUI5,UIUI5,TLUE5-TLTL5-TLUE5-UE5.TLTL5.UETL5.UPUPS9S9S9WQ5-WQWQWQVU5-W@VU5-X#VUVUW@5-WQWQWQWQWQVVWQVVWQVVW+WEW+WEW+WEW+5*W+5*W+5+5+WE5,WEWEWE5,W+5,W+W+W+W+W+W+WEX#W9X#W9W9W95*W95*W9X#X#W9W9W9W<W9W9W9W<W<W<W<5(W<5(W<W:W<W:W<5(W:W:5(W:WUWUW:5(5(5)W<W<W<W<W)W<W<W<W<W)W)W)W<W)W<W<W)W<W<W<W)W)W<W)W)W)W)W)W<W<W<4ZW<W<4ZW)W<W)W)W)W)4Z4ZW<5#W<W)5#W)W)5#W<5$W<WUWU5$5%WUWU5%5&WUWU5&5'WUWU5'WUWUWU5'WX5'WUWXWUT>T>T>5'5'5(UIUIUHTHUHTHUHTHUHTH5&THTATAV<V<V5V5T+T+T+5%T+T+5%UCUCU?U?U?5$V1V1V1SASZ5$SZSZSZS=S=WQWQWQVMX-X-4ZX-X*4ZVX5#X*5#5$VXVX5$VX5%X*X*5%X*VX5%VXVXWU5%WUWU5%5&5'5(5(W1W1W1W1W1WUWUW1W1WUWUUIUIUIU*T:T:TITITD5$TD5%S4S45%S4S=S4S4S4S45$S4S4T#T#S.S.T#T#S.S.S-S-S-S.S@4YS@S@4YSX4ZSXS@4ZS@S@4Z5#S@S@S?S?S?SUTDTI4ZTIS.SMS.SMS.SMS.SMS.SMS.S.4WSMS.4XSMSM4XSM4XT$SMT$SM4XSMSM4XT$T$T$T$4XT$4YT$4YT$4Z4Z5#SJSJS3S35#5$SO5$SOSGSGSG5$SGSO5$SOSOSG5$SGSWSGSGSGSW5#SWSWSWW>W>5#5$W>W>5$5%5%WVWVWVWVWV5%5&W$5&W?W?5&U#5'U#SJS75'S7SNSNSJSJSJSJSNSJSJSJSJSNS75$S75%5%5&SJSJS7SJSJSJSOSG5%5&5&SGSOSGSGSGSISGSOSO5%SISO5%SOSISOSI5%SI5%SISOSOSISISIS8SO5$SOS8SGSGSG5$SIS>SIS>5#5$S8S8S85$S8S85$S>S>S>SWSWS>5$SWSW5$SWS>S>5$SWWLWCWCWCV$5#V$TPT=V(V(V(V(V(4ZV(T=V(T=4ZV(U@U@U@V(4YT=T=4YT=T=T=4YU@T=T=U#V(V(V(V(V(U@U@V(V(U@U@4VSOSPSPSOSPSPSPSP4USPSPS>S>SP4U4US6SPSPS6S64US64US6SRS6S6S6SR4USR4USRSR4US64V4WU=V,V,V,4VT1T1T1U<4VTGTGTGTG4VTGTPTP4VTPTGTGTG4V4VSPSDSPS6S6S64VSDSDSD4V4VSESESET1T1T5T1T0T;T0T0T/4TT/T/4TT0T/T0T0T0T04TT0T;T04TT04TT0T04TT;4UT;4UTGT;TGT;T;T;4UV.V.4UV.4UV.T0T0T04UT0V.T0T04U4VT;T;4V4WT04WV.V.SCSCSCSESCSCSC4VSE4VSSSS4VSSSSSSSESE4VSS4VSSSSSSX;4VXDXD4VXDXDXDT3T3T5T3T54UT5T5T3T34UT5T3T3T54U4U4VT5T5T3T34VT5T0T0T7T0T0T04U4VT04VT0T.4V4WT.4XT0T0T.T.4WT.T.T.T0T04WV.4WUMUMUMUMV.UM4WV.V.4WV.T0T0T04W4WUMT0UMT04WT0T0T04WT04XT0T04XT0T0T0T.4XUMUM4XUMV.V.V.4XV.V.4XV.4XUMUMUMUMUMT.4XSESSSE4XXDXD4X4YXB4YXBXBXDXD4Y4ZXDXD4ZXBXB4ZXBXB4ZT.T5T54Z5#T4T4T/T/T4T4T/4ZT4T44ZT/T4T4T/4ZT4T4YUY7YU4ZY7Y7YUYUY7Y74YY7YU4YYUYU4YY7YUYUYUYUYUY7YU4XY7Y7X.X.X.4XX.X.4X4YX&4YX&X&4YX&X&X&4Y4ZX&X&Y4Y44Z5#5#5$5%Y@5%5&Y@Y@Y@Y@5&5'5'Y4Y4Y4Y@Y@5'5(Y,Y,5(Y,Y'Y'Y,Y,5'Y,5(Y,5(Y,5)Y,YHYH5)5*YHYH5*YHY3Y3Y,Y,Y35)Y,Y,5)Y,Y,Y,YUYUY3YUY3YUY35(Y,Y,Y,Z&Y,Z&Y,Z&5&Z&Z&Z&Y,Z&Y,5&Y,5&Y,Z&YLYLZ$Z$YLYLZ$5%YV5%YLYLYVYV5%YV5%YLYLYL5%5&5'YG5'5(YXYNYNX.X.X.YN5'YNX.YNYNYN5'YNYN5'5(YNYN5(YNYNYN5(5)5)X.5*X.X.X.YNYNX.X.5)X.YNYN5)X.5)5*YGYGYGYGYG5*YG5*YGX.YGYGYG5*5*X.X.X.YG5*X.X.YGYGX.YGYGYGX.5)X.X.WO5)X.X.X.X&5(5)X&X&5)X&X&X&WGWGW=5)5)WGW=W=W35)W3W3W=W=W=W3V=V=V=5(V=V=5(V=V=V=V=5(V=V=5(5)V=V=V=5)V=V=5)V=5)TLUT5*5*5+V?TL5+TLTLTL5+UG5,5-5-V9V;5.5.V;V;V;5.5/V;V;UGUG5/UG5/50TLTLTLUGTL50UGUG50TU50TLTLTL5051TUTUUKUKUK51UKUK51UKUPUKUPUKUKUK50UKY.Y.YI50YI50YIYIY.Y'Y.50Y'Y'Y.Y.Y.Y.5/505051YIYI51YIYIYIY.Y.5152Y.Y.52Y.5253YI54Y.Y.Y.545455YIYI55Y.56Y.56Y.YIYIY'Y'56Y'Y'Y'56575758Y.Y.Y'Y'5859Y'Y.595:Y'Y'Y.Y'Y'Y'Y'Y.Y.Y'Y.Y.57Y.Y.Y.Y.Y'Y.57Y.57Y.Y.Y'Y'57Y.Y'57Y.Y.57Y'5859Y'Y'Y,Y,Y'58Y'Y'Y,Y,Y'Y,Y'57Y'Y'Y'57Y,Y,5758Y,Y,Y'Y'Y,Y,Y,Y,57Y,Y'Y,Y'Y'Y,56Y'57Y'Y'Y'57Y'5758Y,Y'Y,Y,Y,Y,Y,57Y,57Y,Y,Y,Y'57Y'Y'5758Y,Y,58Y,Y,Y,58Y.Y.Y.Y'58Y.59Y'Y'Y'59Y'59Y'5:Y'5:Y'Y'Y,Y,5:Y,Y'Y'Y'5:Y,Y,5:Y,5:5;Y,Y,5;Y,5<Y,5<Y'5=Y'Y.5=5>5?5?Y'Y'Y'5?Y'5@5A5A5BY'5C5C5DY.5EY'Y'5EY'5E5FY'Y,Y,Y,Y.Y,Y.Y.YIYIY.Y.YI5DY.Y.5DY.Y.5DYIYIYIY.YIY.Y.YAY.5CYAYA5CYAY.Y.Y.5CYI5CYIYI5C5DYIYI5DYAYAYAYAYA5D5EYAYAYA5EYAYA5EYIYAYA5E5F5FY,YAY,YI5FYI5GY,Y,5GY,5GY,YIYI5G5H5IYI5I5JYIYIY,Y,5J5KZ)Z)YIYIYI5JZ)Z)Z)5JYIYI5J5K5LZ)5L5MYIYI5MZ)Z)5NZ)YI5N5O5O5PYIYIZ)Z)YIYIZ)Z)YIYIYIYIYMYMYIYMYI5MZ)Z)YMYMYMYM5LYMYIYI5L5MYIYMYIYI5LYMYMYMY,5LYIYIY,Y,5LY,YI5L5M5NYIYI5NY,5NY,Y,Y,5NY,Y,Y,Y,Z&5NZ&5NZ&5OZ&Y,Z&5OZ&5OZ&Y,Y,Y,5OY,5PY,Y,Y,Z&5OZ&5PZ&5PYKYKYKY,Y,Y,5PY,Y,YKYKY,Y,YKYKY,YKYKYKY,Y,5MY,YKY,YKYKY,5L5MZ&Y,5MY,5N5NZ&Z&Z&YIYIYI5NYI5N5OY,YI5OYI5P5P5Q5RY,YIYIYI5RYI5RYIYIYIY,5RY,5RY,YIY,5RY,YI5SY,Y,5SY,Y,Y,Y,5S5SZ)Z)Z)5S5TZ)Z)5T5UZ)Z)Z)5UZ)Z)Y,Y,Y,5UY,Y,5UY,5U5VZ)Z)Z)Y,Z)Z)5UZ)Z)Z)Y,Y,5UY,Y,Y,5UY,Z)Y,Z)Z)Y,Z)Z)Z)5S5TZ)Z)Y,Y,Z)Y,Y,Y,Z)5SY,Y,Z#Z#5RZ#5SZ#Z)Z#Z)5S5SZ#5TYZZ#Z#Z#YMZ)Z)Z)YMZ)Z)YMYMZ)Z)YMZ)Z)Z)Z)YMZ)Z)Z)5O5OZ)5P5QZ)YM5QYMZ)Z)Z)5Q5QYM5RYMYM5RYMYMZ)5RYMYMZ)Z)Z)5RZ)YM5RYMY,Y,Y,5R5RZ#Z#Z#Y,Y,Z#Z#5QZ#Z#Z#Y,Z#Y,5QY,5QY,Z#Y,Y,Y,5QY,Y,5QZ#Y,Y,Y,Z#Y?Z#Y?Y?YMYMYMY?5NY?5O5PY?Y?5PY?Z#Z#Y?Y?YMYMYM5OY?Y?Z'5O5OY?Y?Y?5O5PYMYMY?Y?5P5QYMYM5QYM5QY?5R5SYKYKZ#YKYKYKYKZ#YKYKZ#5QYKYK5QYKZ&Z&YKYKZ&YKYKYKZ&Z&YK5OZ&Z&5O5PZ&Z&5PZ&YK5PYKYK5PZ&YK5QYK5QYKYKZ&Z&5QZ&YKYKYKY-YKYKYK5P5PY-Y-Y-5PY-Y-Y-YKY-Y-Y-YK5OZ#Z#Z#Z#Z#5OZ#Z#5OY0Z#Y0Z#Z#Y0Y0Z#Z#Z#Z#5MZ#Z#Z#5MZ#Z#5MY0Y05MYKZ#YKZ#5MZ#5N5N5OZ#5PZ#5PZ#5QZ#5QZ#Y05QY-Y0Y0Y-Y-Y0Y0Y-Y-Y05PY05PY0Y0Y-Y-Y0Y0Y-Y-Y0Y0Y-Y-Y05NY-Y-5N5OY-Y-5O5PY-5PY0Y05PY-Y0Y05P5QY0Y0Z#5QY?Y?Z#5Q5R5SY0Y05SY05SY0Y?Y?Y?Y?Y?5SY0Y05SY0Z'Z'5S5TZ'Z'5TZ'5TZ'YP5UY0Y05UY0Y-Y-5U5VY05VY0Y0Y-Y0Y0Y05UY0Y0Y0Y-Y-Y-5UY-YYYYYYY-YY5TYYY-Y-Y-5TYYYY5T5U5U5VY0Y0YYYYY0YYY0Y/Y/Y/Y0Y/Y/Y/Y0Y0Y05SY05SY+Y+Y0Y05SY0Y0Y0Y05SY+Y/Y+Y+Y/Y/5R5SY05SY0Y/Y+Y+Y+Y/5RYEZ&5SY<5SY<Y<5SY<Y<Y<Y0Y/Y/Y/YYYYY/5RYYYY5RY/Y<Y<Y2Y2Y<Y<5QY<5QY2Y/Y2Y<Y<Y2Y2Y25PY2Y2Y2Y<Y2Y2Y<Y<Y2Y<5NY<5OY<Y<Y<Y25OY25OY25PY25PY2Y<Y2Y2Y<Y<5OY<5PY<Y<5PY<Y/5PY<Y/Y/5PY/Y/Y/Y<5PY/Y/YGYGY<5P5PYGY<YGYGYGY<Y<YGYGY<Y<Y<Y<Z(Z(Y<5MZ(Z(5MZ(Z(Z(5M5NZ(Z(Y<Y<Z(Z(YGYG5M5NYGYGZ%Z%YQZ%Z%Z%YGYGY<YGY<5K5L5MYGYG5MYGY<YGYGYGY<YG5LYGYGYGYG5LYQYQZ%Z%Z%Z%5KY)X.X.WJWJX.X.VRVRVTVTVQVQVTVTVQVQVT5GVQVQ5GVQVQVQVNX(VN5G5G5HX(X(5HW3X'X'W35H5I5JW%W%WUWUW%W%WU5IW%W%5IW%WUW%WUWUW%W%WUWUWU5GWUWU5G5HWUWUU>U>U>5H5H5IU>U>TUTU5I5JTUTU5J5KTL5KTL5LTUTU5L5MTUTU5M5NTUTU5N5OTU5OTU5PTUTU5PV;TUV;V;V;TUTUTU5OTUTU5O5PTUTU5P5QTU5QTU5RTUTU5RUPTLU55RU5TLU5U5U5TLU4TLU4TL5PTLTLU0UP5PUP5PUPU0UPU9UPU95P5PUPU9U95PUP5QUPTUTUTU5QTU5Q5RV;5RV;5SV;5SV;V;V;5SUPV;V;5SUPV;5TV;UPUPUPV;V;V;5SV;UP5SUPUP5SUPUP5S5TY>Y>YB5T5UY>Y>Y>Y>5U5UYBYBYBYBYBYB5UYB5UYBYB5UYIYBYBY>YB5UYBY(5UY(Y(YIYIY(Y(YI5T5U5VYIYI5VYIYB5VYBYBYIYI5V5WYIYIYBYBYIYI5V5WYIYI5WYIYIYMYIYMYMYM5VYMYIYI5V5WYIYM5WYM5WYMYIYMYMYMYM5WYM5WYMYMYMYM5W5X5X5YYMYM5Y5ZZ'6#6#YPZ'6$6$YPZ'Z'6$YJZ'6%YPYPYP6%YPYPYPY+YPY+YPY+YW6#YW6$6$YSYSYSY+Y+YSYSY/Y/6#Y/Y+6#Y+Y+6#6$Y+Y+YTYT6$Y/YTY/Y/Y/YTY/YTYTY/Y/5Z6#Y/Y/6#6$6$YTYTYT6$YTYTYTY/Y/Y/6$Y/Y/YT6$6$YTYTYT6$Y96%Y9Y*6%Y*6&Y*Y*Y*Y9Y*Y9Y*Y9YGWZYGWZX/X/Y9Y9X/X/Y9Y9X/X/Y9X/Y9Y95X5YX#X#5YX#VWVW5YVWVWVWX#X#5XVWX#X#X#5XX#X#VWVWX#X#VWVW5W5XX/X/5XVWVWVW5X5YWSWSVSVSX#VSX#X#5WWSVSVSVSVSVSWS5VWS5WWSVSWSVSVSWSWS5VW,5VWSVS5WWSWS5WWSVS5WVSVS5WWSVSVSWP5WWPWPVNVNWP5WVNVNVN5WWY5WWYWY5W5X5YWY5Y5ZWYWYVNWYWYWY5Y5ZWYWYW#W#W#5ZW#W#5Z6#6#WYWYWY6#W#WYW#VNVN6#6$W#6$W#W#VNVNW#W#6#6$WYWYVNVNWYWYWYWYWY6#WYWY6#W,W,6#W,W,WYWYW,W,WYWYW,W,WYWYW,W,WY5XWY5Y5YW,W,W,WYWYWY5YWYWY5YWYWYWYW,5YWY5Y5Z6#6#W,6$W,WYWYWY6$WYWYW,W,W#W#WY6#W#W#6#WYW,W,W,6#W,6#W,WY6#6$WYWYW,WYW,W,WYWY6#6$WYWY6$WY6$WYWYWYWYWYWY6$WYWYWY6$W,W,W,W#W,W,W#W#5Z6#W#W#W,6#W,W,6#6$6%W#W#W,W#6%W,W,6%6&WYWY6&W,6&W#W#W#6&W#6'W#6'W#WYW#WYWYW#6'W#W#6'W#W#6'W#W#6'W#W#W#WS6'WSWS6'W,WSWSW,6'W7W7W#6'W#WY6'W#WYW#W#W#6'6(WY6(WYWY6(6)WYWYWYWY6)WYWYWYWYW#WYWY6(6)W#W#6)6*WY6*WYWYW#W#6*W#W#6*WYWY6*W#WYWYW#W#6*6+W#W#WYWYWYWYWYW#WYWYW#WYWYWYW#6(WYWYWY6(WYWY6(6)WY6)6*6+6+W#W#W#6+6,W#W#6,W#W#W#6,WYW#6-6-WY6.W#W#6.W#W#WYWYW#W#6-W#W#W#6-6.W#W#W#6.W#W#6.6/W#W#VNVN6/60VNW#60W#WU60WUWM60WUWMWMWU6061WM61WMWMWM61WM62WMWUWMWUWMWU61WMWM61WMWT6262WT63WTWMWMWM63WM63WTWT63WTWTWTWM63646565WTWTWTWUX+WUX+WUWUWU6464WMWMWMWM64WMWMWMWM64WMWMWM64WTWT64WTWT64UY65UYU>65U>6666UYUYUYU>66V:V:6667V:V:6768V:V:U>68V:V:6869V:V:696:V:V:U>U>6:6;U>UY6;UY6;UY6<6=TTTTUYUYTTTT6<TTUY6<TTTT6<TTTTTTUYUYU/6<UYUY6<6=UYUYU/6=UYUY6=U/TTTT6=6>TTTT6>TT6>6?UUUU6?TTUU6@UU6@UUUUTTTLTTTLTLUPTLUPTLUPTLUPUPUPUP6=TLTLTL6=TLUPTLUPY>6<Y>6=YBYBY5Y5S:S:6<6=S:S:S:6=S:6=S:S:S0S06=S0S:S0S:S:S:S0S:S0W-W-6;6<W-W-6<W-6<W-WFWF6<6=W(W(Y9Y9Y96=Y9Y96=Y96=W-WF6>W(W(VZVZ6=W(VZVZ6=W(VZVZW(W(VZVZVZW(VZ6<W(W(6<W(VZ6<6=W(VZW(W(W(VZW66<W6W6W6W/W/W6W6W/W66:W6W6W6VZVZVZW6VZW(W6W(6869W66:W(W(6:6;VO6;VOVOW(W(VOVOW(W(VOW(69W6W.W.69W6W6W669W6W.W6696:W/W/W6VO6:VO6:VOVOVOY9Y9W(6:W(W(W(6:W(6:VUVUY9Y96:W(Y9Y96:VUVU6:VUVU6:Y9VUVUX#X#VUX#VUX#VUX#VU68VUX#68X#X#X#VUVUVU68VU68VUVU68X#X#X#68X#VUX#VU68VU69X#X#69X#X#X#696:VU6:VUVUX#X#6:X#6:6;VUVUVUVUW@6;6;X#VU6<X#X#6<X#VSVSX#X#VSVSX#X#VS6:X#6;VSVS6;VSX#6;X#X#6;VSVSVS6;6<W76=WSWS6=W7W,W,W76=6=6>W76?W,W,6?W,6?6@W7W76@W76AW76AW96B6CW76CW7W7W7W7W76CW7W9W9W9W76BW7W76B6CW76DW7W7W7W96CW7W9W96CW9W9W9W7W7W76CW9W96CW9W9W96CW9W7W9W7W9W9W<W9W9W96AW9W9W9W96A6B6BW<W9W<W96BW9W9W9W96B6C6CW<W<W<W9W9W96CW9W96CW<W96CW9W<UUTLUUUUTLTL6BTLTMUL6BULULUL6BULTLTL6BTL6BTLUEUETL6BUE6CUE6CUEUE6CTL6DTLUIULUIUITLTLUE6C6CTLUEUETLTLUEUETLTL6B6CUE6CUEUE6CTLUEUE6CTL6DUPS9WQS9WQVU6CVUVU6CX#VUVUW@WQWQWQW+WEW+W+W+W+W+6AW+6AW+W+W+WE6AWE6A6BW+W+6B6CW+W+WE6CW+W+W9W9X#6CX#6CX#X#W<W<W<6CW<6CW<W:W:W:W<W<W:W:6BW:W:6BW:W:W:W:W<W:W:W:W:W<W)W)W<W<W)W)W<W<W)W)W)6>W)6>W)6?W)W<6?W<W)6?W)W)6?W<W<W<W)W<W)W<WUWUWUX-6=X-X-X-WUWUWU6=WUWU6=6>WUWU6>W1WUWUW1W1WUWUW1WUWU6<6=WXWUWUWXWXT>T>T>6<UI6<UIUI6<UIUIUI6<6=TATAT+6=UC6>UCUC6>UCU?UCU?V1SASZ6=SZX-6=6>VXX*X*6>6?VX6?VXX*X*X*6?VX6?6@6AVXX*X*VX6AVX6AVXVX6AX*6BX*VXVXVX6BWUWUWU6BWU6BWU6CWUWUWAWUWU6BWUWU6BWUWUWU6B6CW1W1TD6CTD6DTDTITDTIS4S4S=S=S46BS4S4SXSXS@6BSXSX6BSXS@SXS@SX6ASXS@S@S@6AS@S@6ASX6BSXTDTDTD6BS.SMS.6B6B6CS.S.6CSM6DSM6DT$SMSMSMSMSM6DSMSM6DT$T$SKT$6D6DSK6ESK6ESK6FSKSKSK6FSKS3S3S36FS3S36FSJS3S36F6G6GSO6HSO6HSGSGSGSGSGSO6H6HSG6I6JSGSGSG6JSGSWSWSWW>W>W>6IW>6I6J6K6KW>6L6MW>W>6MWVW>WV6MWVWVWVWVW4WVW4W4W46KW$6LW$U#U#T-U#T-6KT-T-SJ6KSJ6LS7S7S76LS7SJSJSJS7S76KSJS7S7SJSJSOSOSO6J6JSGSGSGSO6JSOSOSOSISISISO6ISOSISOSISO6ISO6ISOSI6IS86JS86JSISISIS8SIS8S8SI6ISIS8S86IS8S>6I6JS>S>S>SWS>6JSWSW6JSWS>6JS>S>6JTP6KTPV(V(V(6KT=V(T=6KV(V(V(6K6K6LT=T=6LU@T=T=6LSO6M6NSP6NSPSP6N6OSP6PSP6PSPSPS6S66PS6SRS6S6S6S6S6S66OS66O6PSRS6S6S66P6PSRSRSRSRS6SRSR6O6PT1T1U<6PTGTGT;TG6PTGTPTP6PV.TGV.TGV.SPSP6O6PS66PS6S6SRSR6PSRSE6PSESET/6PT/T/6PT06QT0T06QT06R6RT;6S6TT06TT0T0T;T;6T6UT06UT0T;6UTGT;6VT;6VT;T;V.V.6VV.6V6W6XT0T06X6YV.T0T0T06Y6YV.6ZV.T;6ZT0T06ZT;7#T;T07#V.V.SCSESCSESESESS6Z6ZSESSSSSESESE6Z6ZSSSSSSX;6ZXDXD6ZXDXDXDT3T36Z7#T57#T5T5T5T3T5T5T56ZT57#T3T3T37#7#T5T5T5T0T0T07#T0T07#T0T07#T.T.7#T0T.7$T0T07$T0T.T0T.7$T0T0T0T.T0T07#7$7$7%UMUMUM7%UMUM7%V.7&7'7'UM7(UMT07(T0UMT0UMT07(T0UM7(UM7(UMT0UMT0T07(T07(T.T.T.7(UM7)UMV.7)UMUMV.V.7)V.UM7)UMUMUMUMT.UMSE7(SE7)XDXDXB7)7)XD7*7+7+7,XBXBXDXDXB7,XDXD7,XDXDXD7,XDXB7,XBXB7,7-T5T5T/T/T4T4T/T/T4T4T/T/T4T4T/T/T4T4T/T/T4T47(YUYUYUY7Y77(Y7Y7Y7YU7(Y7Y77(Y7YUY7YUY7X.X.X.X&7&7'X&X&X.X.X&X&7&7'X&X&7'X&X&X&X.X.7'7(X.X.X.7(Y4Y4Y@7(7(Y@7)Y@Y4Y4Y47)Y47)Y@Y@7)Y@Y@Y@Y4Y47)Y@Y4Y4Y@Y@Y@Y@Y4Y4Y@Y@7'Y@7'7(Y4Y4Y47(Y4Y47(Y4Y4Y4Y'Y,Y'Y'Y'Y'Y'7'Y'7'Y'Y,Y'Y,Y'Y,Y'Y,Y,Y,YH7%YUYU7%YUYUYUYHYHYUYHY3Y37$Y,Y,7$Y,Y,Y3YUY3Y3Y,Y,7#Z&Y,7#7$Z&7$Z&Y,7%7%YLZ$Z$YVYVYLYLYLYV7$YVYL7$YLYLYV7$YVYV7$YG7%YGYV7%YVYG7%7&YXYXYNYN7&YNYN7&7'X.YN7'YNYG7'7(YGYG7(7)YGYG7)YNYNYNX.7)X.X.YNYNX.X.YNYNYN7(7(X.X.X.YNX.7(X.YNX.X.X.X.YGYGYGYGX.YGYGYG7%YG7&YG7&YGX.YGYGYGX.YG7%X.X.YGYGX.7%X.YGX.YGX.X.WOX.X.X.X.7#X.X.7#X&X.X&X&X&WGW=W=W=WGWG6Y6ZW=W=W3W=V=V=U>U>V=V=U>U>V=V=U>U>V=V=U>U>V=V=U>U>V=V=U>U>V=V=U>U>6RTLUT6S6STLTLTLV?V?V?6SV?V?6STLV?V?TLTLUGUGTL6RTL6RTLTLUGUGTLUGV;V9V;V9V96PV;V;V;V;6PV;V9V96P6QV9V9V9V;TL6P6QUG6QUGTLTLUGUGTLTLUGUGTL6PUGUGUG6P6P6QTLTLV;6QTUTUV;V;TUTUUKUK6P6QUKUK6QUKUKUKUPUKY.Y.6PY.YI6PYIYI6PY'Y.Y'Y.Y.Y.6PY.Y.6PYIY.Y.YIYIY.Y.6O6P6PYIYIYI6P6QYIYI6Q6RYIYIY.Y.6RY.YI6RYIYIY.Y.YIY.6QY.YIY.Y.Y.YIYIYI6PYIYI6P6QYIYIY.Y.6QY.YI6QYI6RYIY.YIY.Y.6QY.6RY'Y'Y.Y.Y'6QY.Y.Y'Y'Y'6QY'6QY.Y.Y.6Q6RY.6R6SY.Y.Y'Y'Y.Y.Y'Y.Y.Y.Y'Y'Y.Y.6PY'Y.Y'Y'Y'6PY'6PY.Y.Y.Y'Y'6PY.Y'Y'6PY'Y.6PY.6QY'Y'6QY'Y'Y'Y'6QY'Y,Y'Y'Y,Y'Y,6PY'Y'6P6QY'Y'6QY'Y,Y,Y'6QY,Y,Y'Y,Y'6PY'Y'Y'Y'Y'Y,Y'Y'Y,6OY'6OY,Y,Y,Y,6OY,6OY,6PY,Y'Y,Y'Y'Y'6OY,Y,6OY,Y,Y,Y,Y'Y,Y,Y.Y'Y.Y.Y'Y'6MY'Y.6M6NY'Y'Y'Y'Y,Y'Y,Y'6MY'Y'6MY,Y'Y,Y'6M6MY,6NY,Y'Y'Y'6N6NY,Y,Y,Y'Y'Y'6N6NY,Y,Y,Y,Y,6NY'6N6OY,Y,Y.Y.Y.Y'Y.Y'6NY'Y.6NY.6OY.Y.6O6P6P6QY'Y'6QY'Y'Y'Y'Y'6Q6R6RY,Y'6SY,Y,6SY,Y'6SY'6TY,Y,6TY,Y'6TY'6U6UY'Y.6VY'Y'6VY'6VY'6W6X6XY'Y.Y.Y'6XY'Y,6X6YY,Y,YI6YYIYIY.Y.6YY.Y.6YYIYIY.YAY.Y.YAYA6XYAY.Y.Y.6XY.Y.YIYI6W6XYIYI6X6YYI6Z6Z7#Y.7$7$7%YIYI7%7&YIYIYAYA7&7'YAYA7'YIYAYAYA7'YAY,Y,Y,YA7&YAY,Y,Y,7&Y,YI7&YIYIY,Y,7&Y,YI7&YI7'Y,7'Y,7(YI7(YIYIYI7(YIYIYI7(YIYI7(Y,YIYI7(Y,7)7*7*7+YIYIYIYI7+7,7,7-YIYIYIZ)YIYIZ)Z)7,Z)YI7,YIZ)Z)Z)Z)7,Z)YIYIYI7+Z)7,Z)Z)Z)Z)7,Z)7,YIYI7,YIYIYIZ)Z)YIYI7+YIYIYIYIYMYIYIYMYM7*YMYIYIYM7*YIYIYMYMYMYIYMYMY,Y,Y,7(7(Y,YIYIYI7(YIY,YIYIYI7(7(Y,Y,Y,YIYI7(YIYIY,YIY,7'Y,Y,Y,Y,Z&7'Z&7'Z&Y,Z&Y,7'Y,Y,Y,7'Y,7(Y,Z&Y,Y,7'Z&7(Z&7(Z&Z&Z&Z&Z&7(Z&7(Z&Y,Y,Y,YKYKYKY,Y,Y,7'Y,Y,YK7'Y,7'Y,Z&Y,Y,Y,7'Y,Y,Y,7'7'Z&7(7)7)Z&7*Z&YIYIYI7*YIYIYIY,YIYI7)Y,YI7)7*Y,7*Y,7+Y,YI7+YIY,7+Y,Y,Y,YIY,Y,Y,7*Y,7+Y,7+Y,YIYIYIYIYI7+YI7+YIY,7+Y,YI7,7,Y,YI7-Y,Y,7-7.Y,Y,Y,7.YI7.Z)Z)Z)7.Z)7/Y,Y,7/70Y,Y,Z)Z)7/Z)Z)Z)Y,7/Z)Z)Y,7/Z)Z)7/Y,Z)Z)Y,Y,Z)Z)7.7/Z)Z)Z)Z)Y,Y,Z)Z)7.Z)Y,Y,Z)Z)Y,Y,Z)7-Y,Y,7-Z)7-Z#Z)7.Z)7.Z)7/Z)Z)7/Z#Z#Z#7/Z#7/YZYZYZ7/YZ70YZ70YMZ)Z)Z)Z)70Z)YMZ)7071Z)Z)71Z)Z)YM71YMZ)Z)Z)YMZ)Z)70YM70YMYMYMYMZ)YM70Z)YM70YMZ)Z)YMYMZ)Z)7/70Y,7071Z#Y,71Z#Z#7172Z#Z#Y,72Y,7373Z#Z#Z#7374Y,Z#74Z#Z#Z#YMY?74Y?74Y?YMYMY?74YMYM7475YM76YM76YM77Y?Y?Z'77YM7778Y?78Y?YMYMY?Y?YM78YM78YMYM78Y?YM79YMYM797:7:Y?YM7;YMYMYM7;7;Y?Y?Y?YKYKZ#Z#YKYKZ#YKYKZ&YKYKZ&Z&78Z&Z&Z&7879Z&Z&797:7:7;YKYK7;YKYKYK7;Z&7<Z&7<Z&YK7=Z&Z&YK7=YKYKYK7=YK7=Y-Y-Y-7=Y-Y-YKYKZ#Z#Z#Z#Z#7<7<Y07=Y07=7>Y0Y0Z#Z#7>Z#Z#7>7?Y0YKYKZ#YKY-Y-7>Y-Z#Y-Z#Z#7=Y-Z#Z#Y-Y-7=Y-Z#7=Z#Y-Z#Y-Z#Z#Z#Z#Z#7<Z#7<Z#Y0Y-Y-Z#Y07;Y-Y0Y-Y-Y-Y07;Y07;Y0Y07;7<Y0Y07<7=Y0Y07=Y-Y0Y07=Y0Y0Y0Y-Y-7=Y-Y-Y-7=Y-Y-Y-Y-7=Y-7=Y0Y0Z#Z#7=Z#Y?Y?7=Y?7=7>Y?Y?Z#7>Y?Y?Y?Y07>Y07>Y0Y?Y?Y?Y?Z'7>7>Y07?7@Z'Z'Z'7@Z'Z'YP7@Z'Z'YPZ'Z'Z'Z'7?7?Z'YPZ'Y-Y-Y-7?Y-Y-Y-Y07>7?Y0Y0Y07?Y0Y07?7@Y0Y0Y-Y-Y-7@Y-7@YYYYY-7@Y-7AYYYY7A7BYYYY7BYYY-Y-Y0Y07A7BY0Y0Y0Y07B7CY07CY+Y+Y0Y07CY0Y0Y0Y07CY/Y/Y+Y+Y/Y/7BY/Y07BY0Y/YEYEZ&Z&Z&7AZ&YEYE7AY<Y<YEYEY<Y<YYYYYY7@YYYY7@7A7AY<Y2Y27AY2Y/Y2Y<Y<Y2Y2Y<Y<Y2Y<Y27?Y2Y<Y<Y<Y2Y<Y2Y<Y2Y<Y2Y<7=Y<7=Y<Y2Y<7=Y<Y/7>Y/7>Y/Y/7>7?Y<Y/Y<Y<Y/Y/7>Y/Y/Y/Y<Y<Y/Y/YGYG7=7>YGYGY<Y<Y<Y<7=Y<Y<Y<Y<Z(Y<Y<Z(Z(Y<Y<Z(Z(Y<7:Y<Y<7:YGY<Y<7:YG7;YGYGYGY<Y<YGYG7:7;YGYGY<YGY<YG7:YGYGYGYG7:Z%Y)Y)Y)VT79VQVQ797:VQVQVNX(VNX(VNVN797:7:X(X(X(X'W3X'W3W3W3W379W379X'X'79X'X'X'797:WUWUW%W%WUW%797:WUWU7:X,WUWUX,X,WU7:U>TTU>7:U>U>U>TTU>79TTTTTUTUTLTLTUTUTLTLTUTUU0U07677U0U0TLU077U07778TLTL78TUU0U0TUTUU0U07778U0U0TUTUU0U0TUTU7778TUTUV;V;TU77TU7878V;79V;797:V;V;TUTUTU7:TUTU7:7;TUTU7;7<TUTU7<7=TUTU7=7>7>V;7?V;7?V;V;V;TUTUUPUP7>U57?U5U4U4TLU4U0UPU0UPU0UPU0UPUPUPU97<U97<U9U9V;7<V;7=V;7=V;7>TUTUTU7>7>V;7?V;TU7?TU7@TUV;TUV;7?V;TUV;TUV;TUV;V;7>V;7?UPUP7?7@7@UP7AUPV;V;V;UP7@UPUPUPV;UPUPUPYB7?YBY>7?YBY>Y>YBYB7?Y>YB7?Y>Y>Y>YB7?YBY>7?Y>YBYBYBYBYIYB7>YBYBYIYIYBYIY>YBYBYBYIYIY(Y(YIYIYI7;YIYIYBYBYIYB7:YI7:YIYIYIYBYIYBYIYIYIYBYBYIYIYBYBYIYIYBYIYIYI7677YIYI77YIYMYMYI77YI77YI78YIYIYFYIYMYM77YM77YMYIYMYMYMYM77YM77YMYMYMYM77YO77YMYOYMYOYO777878YMYMYM78YPZ'Z'YPYP78YP78YPZ'YPYPYPZ'YPYPYPZ'77Z'YPZ'Z'Z'YJZ'7676YJZ'YJYP76YPY+YWYWYW76YSYSYWYSYW7576YS76Y/Y+7777Y/Y+Y+Y/Y/Y+Y+Y/Y/Y+Y/YT7576Y/76Y/YTYTY/Y/YTYTY/Y/Y/7575YTYTYTY/Y/757676YTYTYTY/Y/76Y/YTY/YTYT75YTYTYTY9Y975Y9Y*Y9Y*Y*Y*Y*Y*74Y*74Y*Y*Y9Y9Y9X#Y973X#X#73X#X#X#VWVWX#73VW7374X#74VWX#VWX#74X#X#7475X#X#X/VWX/X/VWVWVW74VWVW7475VSWSVS75VSVSVS75VS75VSVS75WSWSW,WSWS75WSWSWSVSWSWSWS74757576VSVSWSWSVSWSWPVNWPWP74VNWP75VNVN75WY75WYWYWYVNVN7576VN76WYWY76WYWYWYVNVN7677VN77WYWY7778WYWYVNWYWYWYW#77W#WYWY77WYWY7778WYWYW#WYWYWYW#WYWYWYVNVNW#W#VNVN75VNW#VNW#W#VNVNVN7474WY75WYWY75W,W,75WYW,W,WYWYW,W,WYWYWY74WY74WYWYWYWYW,W,WYWY7374WYWY74W,WYWYW,W,WYWYWY73WYWY7374WYWY747575WYW,W,WY75WY76WYWYW,W,W#W#WY75W#W#75WYW,W,7576W,W,W,7676WYWYWY76WYWYWYW,76W,W,76WYW,W,WYWYW,WYWYWY75WYWYWYWY75WYWYW#W#W,W,W#W#73W#W#W#7374W,W,7475W,W,75W,W,W,W,W,W#W#W#W#W#74W#W,74W,W,W,W,W#WYWY73WYW,W,W,W#WYWYW#W#71W#W#W#7172WYWYW#727374WYWYWYW#W#WYWYWY72WYWYWYWS72WS73W,W,73WSW,W,7374W#WYW#WYWY73WYW#W#W#W#73W#W#WYW#WY72WYWY72WYWYWYWYW#WYWYWYWY7172WYWY72W#72W#W#W#W#W#WYWYW#W#71W#W#W#717272W#WYWYW#W#W#72W#W#727373W#WY747475WYWYWYWYW#WYWYWYWY74WYWYWY74WY7475W#WYWYWY757576W#W#7677W#W#77W#W#W#WYWYWY77WY7778W#78W#W#W#WYWYW#WYWYWYW#W#WYWY767777W#W#W#W#77W#W#WY7778W#WY78WY7979W#7:W#VNVNW#W#VNVNW#W#VNVNW#78W#78W#W#78VNW#W#VNW#W#W#WUWUWU77WUWU77WUWUWUWU77WUWU77WM77WMWMWMWMWM77WMWUWMWMWMWU76WMWMWMWMWT76WT76WTWTWMWMWM767677WTWTWMWMWM77WM7778WT78WTWTWTWMWMWM78WM78WTWT78WTWTWT78WTWTWTWU78WMWMWUWM7879WM79WM7:WMWMWM7:WMWM7:7;WT7;WTWTU>UYU>UYU>7:U>7;U>U>U>7;U>7;U>U>U>UYUYUYU>U>7:7;U>U>7;V:U>U>V:V:U>U>V:V:U>79V:V:U>U>79V:U>U>V:V:U>U>V:V:U>77V:V:77U>V:V:U>77UYUY77U>UYUY7778UYUYV:UYV:78V:UY78U/UYUY7879UYUYUYTTUYUYTTTT77TTTTTTUY77U/U/7778U/U/78U/U/U/U/78U/U/7879U/U/TTTTUUUUTTTTUUUUTTTT77TTUU77UUUUUU77UUUU77TTUU78TTTT78TTUUTTUUUUUPUP77UPTLUP77UP77YBY>YBY>YBY>777778S:79797:S:S:S:7:7;S;S0S07;7<7<S0S:S:W-W-7<7=W-7=7>WFW-W-7>W-WFW-WFWFY9Y9W(7=7=W(W(W(Y9Y9W(7=Y9Y97=Y9W-W-WFW-W-W-WFWFW(W(7;7<W(W(7<7=VZ7=VZW(7=W(W(W(VZVZVZW(VZVZVZW(VZW6VZW6W6W6W6W/W679W6W6W(W(79W(79W(W6W(VO79VOVOW(W(79W(VOW(VOW(W6W6W.78W.W.78W6W.W.W.W6W6W6W/W/W6W/W/W/W6W6W675W6VOW6VO7475W(W(W(VUW(VUW(74W(VU74W(W(W(Y9Y9Y974VU74VUVUY9Y9VUY9X#73X#X#7374X#X#VUVU747575X#VUVU75X#76X#X#X#VUX#VU7576X#X#X#VUX#X#X#7576X#X#X#76X#X#VUVUX#X#VU7575X#VUX#VUX#VUVU7475VUVUVUVUW@W@X#X#74X#X#X#VUX#VU73VU74VSVSX#VSX#73X#X#VSVS73VSX#X#X#7373VSVSVSW773W7W773WSW7WSW773W7W77374W7W77475W77676W,W777W,W,77W,77W,W778W,W,78W,W778W7W778W,W7W,W7W7W,W7W,W7W,W,W7W9W7W9W775W7W7W9W975W975W9W7W7W775W9W97576W7W7W9W9W7W7W9W975W975W9W7W9W7W775W975W9W9W9W7W9W7W974W9W9W9W7W9W7W773W<W<W<W9W9W97373W<W<W<73W<W9W9W9W<W9W9W9W9W972W972W<W<W9W<W<W<W9W9W971W9W9W9W<W970W9W970TLUU71TM7172UL72UL737474TLUE75UE75UEUETLTL75TL75TLUE76UETLUE76TLTL76TL76TLTLTLTLTLUE767677UE78UE78UEUE78TL79TLUE79UEUE797:UEUETLUPTL7:TL7:UPUP7:X#VUVUX#X#7:7;W+W+W+7;W+WEW+W+7:WE7;WEWEWE7;7<WEWE7<7=WEWE7=W+WEW+W+W+WE7<WEW+W9W97<W9X#7<X#W9W<7<W<7=W<W:W<W:7<W:W<W<7<WUW:7=W)W<W)7=W<W<7=W<7=W<W<W<W<W<7=W<W)7=W)7>7>W<W<W<WU7>7?7@WUWUWU7@WUWUWU7@WU7@W1W17@W1W1W1WUWUWUWXWUWXWXWX7>UIUIUIULUL7>7?UL7?7@UITHTHTATATHTHTATHT+T+UCUCUCUCUC7=UCUC7=UCSA7=SASZX-X-X-7=7=VXVXVX7=X*VXVXX*X*7=X*7=X*X*X*X*X*7=X*X*X*X*7=X*X*7=7>X*VXX*VXX*X*VXX*VX7<VXVXX*X*7<X*VX7<VX7=VXX*VXX*WUW1WUW1WUWUWU7;WU7;WU7<WU7<WUWUWAWA7<WAWU7<W1W17<W1W1W17<TI7=TI7=TITDTI7=S4S4S4SX7=S@7>7>SXS@7?S@7?S@S@S@7?S@S@SXSX7?SXS@7?S@S@TD7?TD7@S.SMS.S.S.SMS.S.SMSM7>7?SMSM7?SMS.SMS.SMSM7>SMSMSMSMSM7>7>7?T$T$T$SK7?SKT$7?T$7@T$7@T$7AT$7A7BSKT$SKSKSK7ASKT$SKS3S37A7BS3S3SJSJS3S3S37A7AS3SO7BS3SOS3SO7ASOSOSOSO7A7BSG7BSGSOSOSOSGSOSGSO7ASOSO7ASOSOSOSGSGSWSWW>W>W>WVW>W>W>7?WV7?WVWV7?WVWVWVW>W>7?W>WV7?WVWVW>W>7?7@W>W>WVWVW>WVW>WVW$W$W$W?W$W?W?W?7<U#T-U#SJSJSJ7<SJ7<SJSJS7S77<7=S77=7>SJSOSOSO7>SGSG7>SGSO7>SOSG7>SISISISISI7>SISISISOSISOS8SOS8SOS8SOS8SG7;SG7<SISISIS8S8S8S8S>SISIS>S>SISIS>S>S>78S>S>78SWS>79S>S>S>SWV$TPV$78V$TPV$TPV(V(V(7777U@T=78V(V(T=T=V(V(77T=V(7778T=U@U@78U@SPSOSP78SP78SPSP78SOSPSPSP78SPSPS>S>SPSPS>S>77S>SP77SPSPSPS6SPSPS6S6SRS6S6S6S6SRSRSR74SR7475SRSRS6S67576S676SRSRU<U<U<76U<U<76U<U<TGTGTGT;TGT;TG747576V.SD76SDSDSPSP76SPS6S6S676SRSR76SRSESDSESET/75T/7676T077T077T0T/T0T0T0T077T077T0T0T0T;T077T077T0T0T;T;77T;T0T;T0T07677T0T0T;T;77T;T077T0T;T;77T;78T;TGT;T;T;T;T;7777V.78V.78V.797:V.V.7:V.T0T0T;T0T0T079V.79V.V.V.T0T079V.T0T0T0V.78V.V.V.T;T;7879T;T;79T;T079T0T0T0T079V.SESESSSSSESESESSSESE7778SE78SESSX;X;7879X;X;797:T57:T5T5T3T37:7;7;7<T5T5T5T3T5T3T5T3T5T5T3T37:T3T57:T5T5T0T0T7T7T0T0T7T7T0T.T.T.T.T0T.T.7677T.T.T0T077T0T.77T.T.UMUMT0UMV.V.UMV.T075T0UMUMV.UMUMUMV.UM74V.V.74V.UM74UMUMV.V.UMV.T0UMT0UM72UM73UM7374UMUM74UMT075T0T0T0UMT0UMT0T073T.T.T.T0T073T073UMT0UMT0UM73UMV.V.UM7373V.UM747475UMUMSSSSSE75SESSSSSS74XBXBXBXDXD74XD7475XBXB75XD76XD76XDXBXBXDXBXBXBXDXDXB75XDXD7576XDXD76XD7677XBXB7778T5T5T.T.T5T.YUY7YUYUYUY7YUYUY7Y7YUYUY7Y7YUY7X.X.X&X&X.X.X&X&X&X.X&X&X.X.X&X&X.X&X&X&X.X.X&X&X.X.X&X&X.X.X.X&Y4Y4Y@Y@Y4Y@Y4Y@Y4Y@Y@Y@Y4Y4Y@Y@Y4Y4Y@Y@Y4Y@Y@Y@Y4Y@Y@Y@Y4Y@Y4Y4Y@Y@Y4Y4Y@Y@Y4Y4Y4Y@Y4Y4Y@Y@Y4Y4Y'Y,Y'Y,Y'Y,Y'Y,YHYHYUYUYHYHYUYUY3Y3Y,Y,Y,Y3Y,Y,Y,Y,Y,Z&Z&Z&Y,Z&Y,Y,Y,Z&Z&Z&Y,Z&Z&Z&Y,Z&YLYLZ$Z$YLYVYLYVYVYVYLYLYVYGYVYVYGYGYVYGYVYVYVYGYVYVYVYGYNYNYXYXYNYNYXYNYXYXYXYNYNYNX.X.YNYNYNX.YNYGYNYNYGYNYGYGYNYNYGYGYGYNYGYGYNYNYGYGYNYNYNYGYNYNX.X.YNX.X.X.YNYNX.X.YNX.YNX.YGYGYGX.YGX.YGX.YGYGYGX.YGYGX.X.X.YGX.YGX.X.X.X&X.X&X&X&WGWGW=W=WGWGW=W=UTTLUTUTUTTLUTUTUTTLUTTLV?V?V?TLV?V?TLTLUGUGTLUGTLUGTLTLV9V;V9V;V9V9V9V;V9V9V;V;V9V9V;V;TLUGUGUGTLUGUGUGUGUGTLUGUGUGTLUGUGUGUGTUUGUGTLTLUGTUTLTLV;V;TUV;UKUKUKUPUKUKUPUPUKUKUPUPY.Y.YIY.Y.Y.YIY.Y.Y'Y.Y.Y.Y.YIYIY.YIYIYIY.Y.YIYIY.Y.YIYIY.YIYIYIY.Y.YIY.Y.Y.Y.YIY.Y.YIYIY.Y.YIY.Y.Y.YIY.Y.Y.YIY.YIYIYIY.Y.Y.YIYIY.Y.YIYIY.Y.YIY.Y.Y.YIYIY.Y.YIY.YIY.YIY.Y'Y'Y.Y'Y.Y'Y.Y'Y'Y'Y.Y.Y'Y'Y.Y.Y'Y.Y.Y.Y'Y'Y.Y.Y'Y.Y.Y.Y'Y'Y.Y.Y'Y'Y.Y.Y'Y'Y.Y'Y.Y'Y.Y'Y.Y'Y.Y.Y'Y'Y.Y.Y.Y'Y.Y.Y.Y'Y.Y'Y.Y'Y.Y.Y'Y'Y.Y'Y'Y'Y,Y,Y,Y'Y,Y,Y'Y'Y,Y,Y'Y'Y,Y,Y'Y'Y,Y,Y,Y,Y'Y'Y'Y,Y'Y,Y'Y'Y,Y,Y'Y'Y'Y,Y,Y,Y'Y'Y'Y,Y'Y'Y'Y,Y,Y,Y'Y'Y,Y,Y'Y'Y,Y,Y'Y'Y.Y.Y.Y'Y'Y'Y.Y'Y.Y.Y'Y,Y'Y'Y'Y'Y'Y,Y'Y,Y'Y'Y,Y,Y'Y,Y'Y,Y'Y,Y'Y'Y,Y,Y'Y,Y'Y,Y'Y,Y,Y,Y'Y,Y,Y,Y,Y'Y'Y'Y'Y'Y,Y,Y'Y,Y,Y,Y.Y.Y.Y'Y.Y'Y.Y.Y.Y.Y.Y'Y.Y.Y.Y'Y.Y'Y'Y'Y.Y'Y.Y'Y.Y'Y'Y'Y'Y'Y.Y'Y'Y'Y'Y,Y'Y,Y,Y,Y'Y,Y'Y'Y'Y,Y'Y,Y,Y,Y,Y'Y'Y,Y,Y,Y'Y,Y'Y'Y,Y,Y'Y,Y'Y,Y'Y,Y'Y,Y'Y,Y.Y'Y.Y'Y'Y'Y.Y.Y'Y'Y.Y'Y.Y'Y.Y'Y'Y'Y.Y.Y'Y'Y.Y.Y'Y'Y'Y.Y'Y'Y'Y,Y'Y,Y,Y,Y'Y,Y,Y,Y.Y.YIYIYIY.YIYIY.Y.YIYIY.Y.Y.YAY.YAY.Y.Y.Y.Y.YIY.Y.YIYIY.Y.YIYAY.YAYAYAYIYAYIYAYAYAY.Y.YAYAY.YAY.YAY.YAYAYAYIYIYAYAYIYIYAYAYIYIYAYAYIYAYAYAYAYIYAYAYIYAYAYAYIYIYAY,YAY,YAY,YAY,Y,Y,YIYIYIY,YIYIYIY,YIY,YIY,YIY,Y,Y,YIYIY,YIY,Y,Y,Y,Y,YIY,YIYIYIY,YIYIYIY,Y,YIYIY,Y,YIYIY,Y,YIY,YIY,YIYIY,YIYIYIYIY,YIYIY,Y,YIY,YIYIYIZ)YIYIZ)Z)Z)Z)Z)YIZ)Z)Z)YIYIZ)Z)Z)YIZ)YIZ)Z)Z)Z)YIYIZ)YIZ)YIYIZ)Z)Z)Z)Z)YIZ)Z)Z)YIZ)YIYIYIZ)Z)YIYIYIYMYIYMYMYIYMYMY,Y,YIY,Y,Y,YIYIYIY,YIYIYIY,YIY,YIY,Y,Y,YIYIY,Y,Y,Y,YIY,Y,Z&Z&Z&Y,Z&Y,Z&Y,Z&Y,Z&Y,Z&Y,Z&Y,Y,Y,Z&Y,Y,Y,Z&Y,Z&Z&Z&Z&Z&Y,Z&Y,Z&Y,Z&Y,Z&Y,Y,Y,Z&Y,Z&YKY,YKYKY,Z&Z&Z&Y,Z&Z&Z&Y,Y,Y,Z&Y,Y,Y,Z&Z&Z&YKYKZ&Z&YKYKY,Y,Y,Z&Y,Z&Z&Z&YIYIYIY,YIY,Y,Y,YIY,Y,Y,YIY,YIY,YIY,YIY,YIY,YIY,YIYIYIY,YIY,Y,Y,YIY,YIY,YIY,YIY,YIY,YIY,YIYIYIY,YIY,Y,Y,YIY,YIY,Y,Y,YIY,YIY,YIY,Y,Y,Z)Y,Y,Y,Y,Z)Y,Y,Z)Z)Y,Y,Z)Y,YIYIZ)Z)Z)Z)Y,Y,Z)Y,Z)Z)Y,Y,Z)Z)Y,Z)Z)Z)Y,Z)Z)Z)Y,Y,Y,Z)Y,Y,Y,Z)Y,Y,Z)Y,Y,Y,Y,Z)Y,Y,Z)Z)Z)Z)Y1Y1Y,Y,Z)Z)Y,Y,Z)Z)Z)Z#Z)Z#Z#Z#Z)Z#Z)Z#Z)Z#Z)Z#Z)Z#Z)Z#Z#Z#YZZ#YZZ#Z)YZYZYZYZYZZ)YZZ)YZZ)Z)Z)Z)YMZ)YMZ)YMYMYMZ)YMYMZ)Z)YMYMZ)Z)YMYMZ)YMZ)YMZ)Z)Z)YMZ)YMYMYMYMZ)YMYMZ)Z)Z)YMZ)Z)YMYMZ)YMYMYMY,Y,Y,Z#Y,Y,Y,Z#Y,Y,Z#Z#Y,Y,Y,Z#Y,Y,Z#Z#Y,Z#Y,Y,Y,Z#Z#Z#Y,Z#Z#Z#Y,Y,Y,Z#Y,Y,Z#Z#Y,Z#Z#Z#YMY?Y?Y?YMY?YMYMY?Y?Y?YMY?Y?YMYMY?Y?YMY?YMY?YMY?YMYMYMY?YMY?YMYMZ'Y?Z'Z'YMY?Y?Y?YMY?Y?Y?Y?Y?YMYMYMY?YMYMYMY?YMYMY?Y?YMYMYMY?YMYMYMYMY?Y?YMYMY?YMY?Y?YMY?Y?Y?YMYMYMY?Y?Y?YMYMYMY?Z&Z&YKZ&Z&Z&YKYKZ&Z&YKYKZ&Z&YKYKZ&Z&YKZ&YKZ&YKYKZ&Z&YKYKZ&Z&YKYKYKYKYKZ&Z&Z&YKZ&YKZ&YKYKZ&Z&YKZ&Z&Z&YKYKYKYKY-YKYKYKYKY-Y-YKY-Y-Z#Z#Y0Y0Z#Z#Z#Y0Z#Y0Y0Y0Z#Z#Y0Y0Z#Z#Y0Y0Z#Z#Y0Y0Z#Y0Z#Y0Z#Y0Y0Y0Z#Y-Z#Y-Z#Y-Z#Z#Z#Y-Z#Z#Z#Y-Y-Y-Z#Z#Z#Y0Z#Z#Z#Y0Y0Y-Y0Y0Y0Y-Y0Y0Y0Y-Y0Y0Y-Y-Y0Y0Y-Y-Y0Y0Y-Y-Y0Y0Y-Y-Y0Y0Y-Y-Y-Y0Y-Y-Y0Y0Y-Y-Y0Y-Y-Y-Y-Y0Y-Y-Y0Y0Y-Y0Y0Y0Z#Z#Z#Y?Y?Y?Z#Z#Z#Z#Y?Y?Z#Z#Y?Y?Z#Y?Z#Y?Y?Y0Y0Y0Y0Y0Y?Y0Y?Z'Z'Z'Y0Z'Z'Z'Z'Y0Y0Y0Y0Y0Z'Y0Z'Z'Z'YPYPZ'YPYPYPYPYPZ'Z'Z'YPYPY-Y-Y0Y0Y-Y-Y-Y0Y-Y-Y0Y0Y0Y-Y0Y0Y-Y-Y0Y0Y-Y0Y0Y0Y-Y-Y-YYY-Y-YYYYY-YYY-YYY-YYY-Y-YYYYY0Y0YYY0Y0Y0Y0YYY0Y0Y-Y-Y0Y0Y-Y0Y0Y0Y0Y0Y0Y+Y0Y0Y+Y+Y0Y+Y+Y+Y0Y0Y+Y+Y0Y0Y0Y/Y+Y/Y+Y+Y0Y0Y0Y/YEYEZ&YEYEYEY<Y<YYYYY/Y/YYYYY/Y/YYY/Y/Y/Y<Y<Y2Y2Y2Y2Y/Y2Y2Y<Y2Y2Y2Y<Y<Y<Y2Y<Y2Y<Y<Y<Y/Y/Y/Y<Y/Y<Y/Y<Y/Y/Y<Y<Y<Y/Y<Y<Y/Y/Y<Y/Y/Y/Y<YGY<Y<YGYGY<YGY<Y<Z(Z(YGYGY<Y<YGYGY<YGY<YGY<YGY<Y<Y<YGYGYGY<YGYGYGY<Y<YGYGY<YGYGYGZ%Z%VTVTVTVQVTVTVQVQVTVQVQVQVNVNX(X(VNX(X(X(VNVNVNX(W3W3W3X'W3W3X'X'W3W3X'X'W%W%WUWUW%W%WUW%WUX,WUWUX,X,WUWUX,X,WUWUWUX,WUX,U>TTU>TTU>TTTTTTTUTUU0U0TUTUU0U0TLU0TLU0TLU0TLTLU0U0TLTLTUTUU0U0TUTUU0U0TUTUU0U0TUTUTUV;TUTUV;V;TUTUTUV;TUV;V;V;TUV;TUV;TUV;TUV;TUTUTUV;TUTUV;V;TUTUTUUPTUTUUPUPTUTUUPUPTUTUUPUPTUTUUPUPTUTUUPUPTUTUUPUPTUTUUPUPTUTUUPUPTUV;TUV;TUV;TUV;TUTUTUV;TLTLTLU5TLU5U5U5UPUPU9U9UPUPU9U9V;UPV;UPV;UPV;UPV;UPV;V;V;V;V;UPTUV;V;V;TUV;TUV;TUTUTUV;TUTUTUV;TUV;V;V;TUTUTUV;V;UPV;UPUPUPV;V;UPUPV;V;UPUPV;UPV;UPV;UPV;UPV;UPV;V;UPUPYBYBYBY>YBYBY>Y>YBYBYBY>YBYBYBY>Y>YBYBYBY>YBYBYBYIYIYBYBYIYIYIYBYBYIYBYIYIYIYBYIYIYIYBYBYIYIYBYBYIYIYBYBYMYMYIYMYIYIYIYFYFYFYIYFYMYMYIYMYIYMYIYMYMYMYMYOYMYOYMYOYMYMYOYOYMYMYOYOYOYOYMYMYOYOYMYMYOYOYOYMYPYPZ'Z'YPYPZ'YPZ'YPZ'Z'YPYPZ'YPZ'YJZ'YJYJYJZ'YJYPY+Y+Y+YWYWYSYSYWYSYWYSYWYSYSYSY/Y/Y+Y/Y/Y/Y+Y/Y+Y/Y+Y+YTYTY/Y/YTYTYTY/Y/Y/YTYTY/YTYTYTY/Y/YTYTY/Y/Y/YTY/YTYTYTY/YTYTYTY/Y/Y/YTY/YTYTYTY9Y9Y*Y9Y*Y9Y*Y*Y*Y*Y*Y9Y9Y9X#X#Y9X#X#X#VWVWX#VWVWVWVWX#VWVWX#X#VWVWX#X#VWVWX#X#VWVWX#X#VWVWX#X#VWVWX#X#VWVWX#X#VWVWX#X#WSWSVSVSVSWSVSWSVSWSVSWSWSWSWSW,WSWSVSVSVSWSVSVSWSWSVSWSVSWSVSVSWSWSVSWSVNVNWPVNVNVNWPWPVNVNVNWYVNWYWYWYVNVNVNWYVNWYWYWYVNVNVNWYVNWYVNVNWYVNWYWYVNVNWYWYVNVNWYWYVNVNWYWYVNVNWYWYW#WYWYWYWYW#WYWYW#W#WYWYW#WYWYWYVNVNW#VNVNVNWYWYVNWYVNWYVNWYWYWYWYWYW,W,WYWYW,WYWYWYWYW,W,W,WYW,WYWYW,W,WYWYW,W,WYW,W,W,WYW,WYWYWYWYW,W,WYWYW,W,WYWYW,W,WYWYW,W,WYWYW,W,W,W,WYW,W,W,WYW,W#W#WYWYW#WYWYWYW,W,W,WYW,WYWYWYW,WYWYWYW,W,W,WYW,WYWYWYWYWYW,W,WYWYW,W,WYWYW,WYWYWYW#W#W,W,W#W#W,WYW,W,WYWYW,W,WYWYW,W,WYW,W,W,W,WYW,W,W#W#W#W,W#W,W,W,WYWYWYW,W#WYW#WYW#W#WYWYW#W#WYW#W#WYW#WYW#WYW#W#WYWYW#WYWYW#WYWYWSWSWSW,W,W,WSWSW,W,WSWSW,W,W7W7W,W,W7W7WYW#WYW#W#W#WYWYWYW#WYWYW#WYWYWYWYW#W#W#W#WYW#WYWYWYWYW#WYWYW#W#WYW#WYWYWYW#WYWYW#W#WYW#WYW#WYWYW#W#WYWYW#W#WYWYW#W#WYWYW#W#WYW#WYW#WYWYW#W#W#WYW#WYWYWYWYWYWYW#WYWYW#W#WYWYW#W#WYWYW#W#WYW#WYW#WYWYWYW#WYWYW#W#WYWYW#WYW#W#WYW#WYW#W#W#WYWYWYW#WYWYW#W#WYW#W#W#WYWYW#W#WYWYWYW#WYWYW#W#WYW#WYW#WYWYW#W#WYW#W#W#WYW#W#W#W#W#WYWYWYWYW#W#W#W#WYWYWYWYW#W#W#VNW#W#VNVNW#W#VNVNW#VNWUWUWMWMWMWMWMWUWUWUWUWMWUWUWUWMWUWUWUWMWUWMWUWUWUWUWMWMWMWMWTWTWMWMWTWTWMWTWMWTWMWMWMWTWMWTWTWTWMWMWTWMWMWMWTWTWMWTWTWTWMWMWTWTWMWTWTWTWMWMWMWTWMWMWTWTWMWTWTWTWUWUWMWMWUWMWMWMWMWUWMWMWMWTWMWMWMWTWMWTWMWMWTWMWMWMWMWTWMWMWTWTWMWTWTWTUYUYU>UYU>UYU>UYU>UYUYUYU>UYU>U>U>U>V:V:U>U>V:V:U>U>V:V:U>U>V:V:U>U>V:V:U>U>U>V:U>U>V:V:U>U>UYUYU>U>UYUYU>U>UYUYU>UYUYUYV:UYV:UYV:V:U/U/U/UYU/U/UYUYU/U/UYUYUYTTUYUYU/U/UYUYU/U/UYUYU/U/UYUYU/U/UYUYU/U/UYUYU/U/UYUYU/U/TTTTUUTTTTUUUUUUUUTTUUUUTTTTUUTTTTTTUUTTUUTTUUUUUPUPTLUPTLTLUPUPY>YBY>YBY>YBY>YBS:S;S:S;S:S:S;S;S;S;S:S:S:S:S;S:S:S:S;S:S:S:S;S:S:S;S:S:S:S0S:S:S0S0S:S0S0S0S:S0W-W-WFWFW-WFWFWFW-W-W-WFWFW-WFWFWFW-WFW-Y9Y9W(W(Y9Y9Y9W(W(Y9W(W(W(Y9W(W(W(W(VZVZW(W(VZW(W(W(W(VZW(W(VZW(VZVZW(VZVZW(VZW(W6W(W6W6W6W(W6W(W6W(W6W6VOW(VOW(W(W(VOW(W6W6W.W6W.W.W.W6W6W6W6VOY9Y9W(Y9Y9Y9W(W(W(W(W(VUY9Y9W(W(Y9VUY9VUY9Y9VUY9X#VUX#X#VUVUX#X#VUVUX#X#VUVUVUX#VUX#X#X#X#X#VUX#VUVUVUX#X#X#VUX#VUVUVUX#VUVUX#X#VUX#VUVUX#X#VUX#X#VUVUVUVUX#VUVUVUX#VUX#X#X#X#VUX#X#VUVUVUX#VUVUVUX#VUX#VUX#VUX#X#VSX#X#VSVSX#VSX#X#X#VSX#VSVSVSW7WSW7W7WSWSW7WSWSWSW7WSWSWSWSW7WSWSW7W7W7W,W7W7W,W,W7W,W7W,W7W7W,W,W7W,W7W,W7W7W,W,W7W,W7W,W7W7W7W,W7W7W,W,W7W,W7W,W7W7W,W,W7W,W7W9W7W7W7W9W7W9W7W9W7W7W7W9W9W9W9W9W7W7W9W9W7W9W9W9W7W9W7W9W7W9W7W7W7W9W7W7W7W9W7W9W9W9W9W9W9W<W9W9W<W<W9W9W9W<W9W<W9W<W9W<W<W<W9W9W9W<W9W9W9W<W9W<W9W<TLTLUUTLTLTLUUTLTMULTMULTMTMTMULULULTMULTMULTMTMULULTMULUETLUEUEUETLUETLTLTLUETLTLTLUETLUETLUEUEUETLTLTLTLTLUEUETLTLUETLUETLTLTLUETLUETLTLTLUEUETLTLUETLUETLUEUETLTLUETLTLTLUETLUETLUEUEUETLUEUETLTLUEUETLTLUETLTLUPTLUPTLUPUPUPX#X#VUVUX#X#VUVUX#X#VUX#W+W+W+WEW+W+W+WEW+WEWEWEW+WEW+W+WEWEW+WEWEWEW+W+WEWEW+W+WEW+WEW+W+W+WEW+X#W9X#X#X#W9W9W9W<W<W<W:W<W:W:W:W<W:W<W:WUWUW:W:W:WUW:W:W)W<W)W)W)W<W)W<W)W)W)W<W<W<W)W)W)W)W)W<W)W<W)W<W)W)W<W)WUX-X-X-WUWUX-X-WUX-X-X-WUWUW1WUWUW1W1W1WUWUWUW1WUW1W1W1T>UIUIUIUIULUIUIULULUIULULULUIUIULUIULUIUCUCU?U?UCUCU?U?SASZSASZX-X-X-VXX-VXX-VXX*X*VXVXVXX*VXX*VXX*VXX*X*X*X*VXX*X*X*VXX*X*VXVXX*VXVXVXVXX*VXVXVXX*VXVXX*X*VXX*VXX*VXX*WUWUWUWAWUWAWAWAWUWAWUWAWUWUWUWAWAWAWUWAWUWUWUW1WUW1W1W1TDTITITITITITDTITDTITDTDS4S=S4S4SXSXSXS@SXSXS@S@SXSXS@S@SXSXS@SXSXSXS@SXSXSXS@S@S@SXS@S@S@SXS@SXTDTITDTITDTITDTISMSMS.S.SMSMS.S.SMSMS.S.SMT$SMSMSMT$SMSMSMSMSMT$SMSMT$T$T$T$T$SKT$T$T$SKT$SKT$SKT$SKT$SKT$SKT$T$T$SKSKSKT$SKT$SKT$SKT$SKS3SJSJSJSJS3SJSJS3SOS3SOS3S3SOSOSOS3SOSOS3SOS3SOSOSGSGSGSOSOSOSGSOSGSOSOSOSGSOSOSGSGSOSOW>W>WVWVW>W>WVWVW>WVWVWVW>W>WVW>WVW>WVWVWVW>WVWVW>WVWVWVT-U#T-U#SJS7SJS7SJS7SJSJS7S7S7SJS7S7SJSJS7S7S7SJS7S7SJSJSOSGSOSGSOSGSGSGSOSGSOSGSOSOSOSISISISOSISGSGSGSISGSISGSIS>SWS>S>SWSWS>SWSWSWS>S>V$TPTPTPV(V(V(T=T=V(T=T=T=U@T=T=V(V(T=T=V(T=T=T=V(V(T=T=U@U@T=T=SOSOSPSOSPSOSPSPSOSOSOSPSOSPSPSPS>S>SPS>SPS>SPSPS6S6S6SRSRS6SRSRS6S6S6SRS6S6S6SRS6S6SRSRS6S6SRSRU<U<U<T1U<U<T1U<TPTPTPV.TPTPV.V.TPV.V.V.SPSPSDSPSDSPSDSPS6SRS6S6SDSRSDSRT/T/T0T0T/T0T/T/T/T/T0T0T0T0T/T0T/T0T/T0T0T0T;T;T0T;T0T0T;T;T0T;T0T;T0T0T0T;T0T;T0T;T0T0T;T;T0T;T;T;T0T;T;T;T0T;TGTGT;TGT;TGT;T;T;V.T;T;V.V.T;V.T;V.T;V.T;V.T;V.T;V.T;T0V.V.T0T0V.V.T0V.T0T0V.V.T0V.V.V.T0T0T0V.T0V.V.V.T;T;T0T0T;T;T0T0T;T;T0T;T;T;T0T;T0V.V.V.SESESESSSESSSSSSSESSSESSX;XDXDXDXDX;XDXDX;X;XDXDX;XDXDXDT3T3T5T3T5T3T5T5T3T3T5T3T3T3T5T3T3T3T5T5T3T3T5T5T3T3T5T5T.T0T.T.T0T0T.T0T.T0T.T.T.T0T.T.UMUMT0UMUMV.UMUMV.UMUMUMV.V.UMV.T0UMT0UMT0T0T0UMT0T0T0UMT0UMUMUMT0UMT0T0T0UMT0T0T0T0T.T.T.T0T.T.T0UMT0UMT0UMUMUMUMV.UMV.V.V.UMUMUMV.UMUMUMV.UMUMV.V.UMUMSESSSSSSXDXDXBXBXDXDXBXDXBXDXBXDXDXDXBXDXDXDXBXDXBXDXBXBXDXDXBXDXBXDXBXBXDXDXBXBXDXDXBXDXDXDXBXDXBXDXBXBXDXDXBXBT5T.T5T5T.T.T5T5", T = [
			"Africa/Abidjan",
			"Africa/Accra",
			"Africa/Addis_Ababa",
			"Africa/Algiers",
			"Africa/Asmara",
			"Africa/Bamako",
			"Africa/Bangui",
			"Africa/Banjul",
			"Africa/Bissau",
			"Africa/Blantyre",
			"Africa/Brazzaville",
			"Africa/Bujumbura",
			"Africa/Cairo",
			"Africa/Casablanca",
			"Africa/Ceuta",
			"Africa/Conakry",
			"Africa/Dakar",
			"Africa/Dar_es_Salaam",
			"Africa/Djibouti",
			"Africa/Douala",
			"Africa/El_Aaiun",
			"Africa/Freetown",
			"Africa/Gaborone",
			"Africa/Harare",
			"Africa/Johannesburg",
			"Africa/Juba",
			"Africa/Kampala",
			"Africa/Khartoum",
			"Africa/Kigali",
			"Africa/Kinshasa",
			"Africa/Lagos",
			"Africa/Libreville",
			"Africa/Lome",
			"Africa/Luanda",
			"Africa/Lubumbashi",
			"Africa/Lusaka",
			"Africa/Malabo",
			"Africa/Maputo",
			"Africa/Maseru",
			"Africa/Mbabane",
			"Africa/Mogadishu",
			"Africa/Monrovia",
			"Africa/Nairobi",
			"Africa/Ndjamena",
			"Africa/Niamey",
			"Africa/Nouakchott",
			"Africa/Ouagadougou",
			"Africa/Porto-Novo",
			"Africa/Sao_Tome",
			"Africa/Tripoli",
			"Africa/Tunis",
			"Africa/Windhoek",
			"America/Adak",
			"America/Anchorage",
			"America/Anguilla",
			"America/Antigua",
			"America/Araguaina",
			"America/Argentina/Buenos_Aires",
			"America/Argentina/Catamarca",
			"America/Argentina/Cordoba",
			"America/Argentina/Jujuy",
			"America/Argentina/La_Rioja",
			"America/Argentina/Mendoza",
			"America/Argentina/Rio_Gallegos",
			"America/Argentina/Salta",
			"America/Argentina/San_Juan",
			"America/Argentina/San_Luis",
			"America/Argentina/Tucuman",
			"America/Argentina/Ushuaia",
			"America/Aruba",
			"America/Asuncion",
			"America/Atikokan",
			"America/Bahia",
			"America/Bahia_Banderas",
			"America/Barbados",
			"America/Belem",
			"America/Belize",
			"America/Blanc-Sablon",
			"America/Boa_Vista",
			"America/Bogota",
			"America/Boise",
			"America/Cambridge_Bay",
			"America/Campo_Grande",
			"America/Cancun",
			"America/Caracas",
			"America/Cayenne",
			"America/Cayman",
			"America/Chicago",
			"America/Chihuahua",
			"America/Costa_Rica",
			"America/Creston",
			"America/Cuiaba",
			"America/Curacao",
			"America/Danmarkshavn",
			"America/Dawson_Creek",
			"America/Denver",
			"America/Detroit",
			"America/Dominica",
			"America/Edmonton",
			"America/Eirunepe",
			"America/El_Salvador",
			"America/Fort_Nelson",
			"America/Fortaleza",
			"America/Glace_Bay",
			"America/Godthab",
			"America/Goose_Bay",
			"America/Grand_Turk",
			"America/Grenada",
			"America/Guadeloupe",
			"America/Guatemala",
			"America/Guayaquil",
			"America/Guyana",
			"America/Halifax",
			"America/Havana",
			"America/Hermosillo",
			"America/Indiana/Indianapolis",
			"America/Indiana/Knox",
			"America/Indiana/Marengo",
			"America/Indiana/Petersburg",
			"America/Indiana/Tell_City",
			"America/Indiana/Vincennes",
			"America/Iqaluit",
			"America/Jamaica",
			"America/Juneau",
			"America/Kentucky/Louisville",
			"America/Kentucky/Monticello",
			"America/Kralendijk",
			"America/La_Paz",
			"America/Lima",
			"America/Los_Angeles",
			"America/Lower_Princes",
			"America/Maceio",
			"America/Managua",
			"America/Manaus",
			"America/Marigot",
			"America/Martinique",
			"America/Matamoros",
			"America/Mazatlan",
			"America/Menominee",
			"America/Merida",
			"America/Mexico_City",
			"America/Miquelon",
			"America/Moncton",
			"America/Monterrey",
			"America/Montevideo",
			"America/Montserrat",
			"America/Nassau",
			"America/New_York",
			"America/Nome",
			"America/Noronha",
			"America/North_Dakota/Beulah",
			"America/North_Dakota/New_Salem",
			"America/Ojinaga",
			"America/Panama",
			"America/Pangnirtung",
			"America/Paramaribo",
			"America/Phoenix",
			"America/Port-au-Prince",
			"America/Port_of_Spain",
			"America/Porto_Velho",
			"America/Puerto_Rico",
			"America/Punta_Arenas",
			"America/Rankin_Inlet",
			"America/Recife",
			"America/Regina",
			"America/Rio_Branco",
			"America/Santarem",
			"America/Santiago",
			"America/Santo_Domingo",
			"America/Sao_Paulo",
			"America/Scoresbysund",
			"America/Sitka",
			"America/St_Barthelemy",
			"America/St_Johns",
			"America/St_Kitts",
			"America/St_Lucia",
			"America/St_Thomas",
			"America/St_Vincent",
			"America/Tegucigalpa",
			"America/Thule",
			"America/Thunder_Bay",
			"America/Tijuana",
			"America/Toronto",
			"America/Tortola",
			"America/Vancouver",
			"America/Whitehorse",
			"America/Winnipeg",
			"America/Yakutat",
			"America/Yellowknife",
			"Antarctica/Casey",
			"Antarctica/Davis",
			"Antarctica/DumontDUrville",
			"Antarctica/Macquarie",
			"Antarctica/Mawson",
			"Antarctica/McMurdo",
			"Antarctica/Rothera",
			"Antarctica/Syowa",
			"Antarctica/Troll",
			"Antarctica/Vostok",
			"Arctic/Longyearbyen",
			"Asia/Aden",
			"Asia/Almaty",
			"Asia/Amman",
			"Asia/Anadyr",
			"Asia/Aqtau",
			"Asia/Aqtobe",
			"Asia/Ashgabat",
			"Asia/Atyrau",
			"Asia/Baghdad",
			"Asia/Bahrain",
			"Asia/Baku",
			"Asia/Bangkok",
			"Asia/Barnaul",
			"Asia/Beirut",
			"Asia/Bishkek",
			"Asia/Brunei",
			"Asia/Chita",
			"Asia/Choibalsan",
			"Asia/Colombo",
			"Asia/Damascus",
			"Asia/Dhaka",
			"Asia/Dili",
			"Asia/Dubai",
			"Asia/Dushanbe",
			"Asia/Famagusta",
			"Asia/Gaza",
			"Asia/Hebron",
			"Asia/Ho_Chi_Minh",
			"Asia/Hong_Kong",
			"Asia/Hovd",
			"Asia/Irkutsk",
			"Asia/Jakarta",
			"Asia/Jayapura",
			"Asia/Jerusalem",
			"Asia/Kabul",
			"Asia/Kamchatka",
			"Asia/Karachi",
			"Asia/Kathmandu",
			"Asia/Khandyga",
			"Asia/Kolkata",
			"Asia/Krasnoyarsk",
			"Asia/Kuala_Lumpur",
			"Asia/Kuching",
			"Asia/Kuwait",
			"Asia/Macau",
			"Asia/Magadan",
			"Asia/Makassar",
			"Asia/Manila",
			"Asia/Muscat",
			"Asia/Nicosia",
			"Asia/Novokuznetsk",
			"Asia/Novosibirsk",
			"Asia/Omsk",
			"Asia/Oral",
			"Asia/Phnom_Penh",
			"Asia/Pontianak",
			"Asia/Pyongyang",
			"Asia/Qatar",
			"Asia/Qostanay",
			"Asia/Qyzylorda",
			"Asia/Riyadh",
			"Asia/Sakhalin",
			"Asia/Samarkand",
			"Asia/Seoul",
			"Asia/Shanghai",
			"Asia/Singapore",
			"Asia/Srednekolymsk",
			"Asia/Taipei",
			"Asia/Tashkent",
			"Asia/Tbilisi",
			"Asia/Tehran",
			"Asia/Thimphu",
			"Asia/Tokyo",
			"Asia/Tomsk",
			"Asia/Ulaanbaatar",
			"Asia/Urumqi",
			"Asia/Ust-Nera",
			"Asia/Vientiane",
			"Asia/Vladivostok",
			"Asia/Yakutsk",
			"Asia/Yangon",
			"Asia/Yekaterinburg",
			"Asia/Yerevan",
			"Atlantic/Azores",
			"Atlantic/Bermuda",
			"Atlantic/Canary",
			"Atlantic/Cape_Verde",
			"Atlantic/Faroe",
			"Atlantic/Madeira",
			"Atlantic/Reykjavik",
			"Atlantic/South_Georgia",
			"Atlantic/St_Helena",
			"Atlantic/Stanley",
			"Australia/Adelaide",
			"Australia/Brisbane",
			"Australia/Broken_Hill",
			"Australia/Currie",
			"Australia/Darwin",
			"Australia/Eucla",
			"Australia/Hobart",
			"Australia/Lord_Howe",
			"Australia/Melbourne",
			"Australia/Perth",
			"Australia/Sydney",
			"Etc/GMT",
			"Etc/GMT+1",
			"Etc/GMT+10",
			"Etc/GMT+11",
			"Etc/GMT+12",
			"Etc/GMT+2",
			"Etc/GMT+3",
			"Etc/GMT+4",
			"Etc/GMT+5",
			"Etc/GMT+6",
			"Etc/GMT+7",
			"Etc/GMT+8",
			"Etc/GMT+9",
			"Etc/GMT-1",
			"Etc/GMT-10",
			"Etc/GMT-11",
			"Etc/GMT-12",
			"Etc/GMT-2",
			"Etc/GMT-3",
			"Etc/GMT-4",
			"Etc/GMT-5",
			"Etc/GMT-6",
			"Etc/GMT-7",
			"Etc/GMT-8",
			"Etc/GMT-9",
			"Etc/UTC",
			"Europe/Amsterdam",
			"Europe/Andorra",
			"Europe/Astrakhan",
			"Europe/Athens",
			"Europe/Belgrade",
			"Europe/Berlin",
			"Europe/Bratislava",
			"Europe/Brussels",
			"Europe/Bucharest",
			"Europe/Budapest",
			"Europe/Busingen",
			"Europe/Chisinau",
			"Europe/Copenhagen",
			"Europe/Dublin",
			"Europe/Gibraltar",
			"Europe/Guernsey",
			"Europe/Helsinki",
			"Europe/Isle_of_Man",
			"Europe/Istanbul",
			"Europe/Jersey",
			"Europe/Kaliningrad",
			"Europe/Kiev",
			"Europe/Kirov",
			"Europe/Lisbon",
			"Europe/Ljubljana",
			"Europe/London",
			"Europe/Luxembourg",
			"Europe/Madrid",
			"Europe/Malta",
			"Europe/Mariehamn",
			"Europe/Minsk",
			"Europe/Monaco",
			"Europe/Moscow",
			"Europe/Oslo",
			"Europe/Paris",
			"Europe/Podgorica",
			"Europe/Prague",
			"Europe/Riga",
			"Europe/Rome",
			"Europe/Samara",
			"Europe/San_Marino",
			"Europe/Sarajevo",
			"Europe/Saratov",
			"Europe/Simferopol",
			"Europe/Skopje",
			"Europe/Sofia",
			"Europe/Stockholm",
			"Europe/Tallinn",
			"Europe/Tirane",
			"Europe/Ulyanovsk",
			"Europe/Uzhgorod",
			"Europe/Vaduz",
			"Europe/Vienna",
			"Europe/Vilnius",
			"Europe/Volgograd",
			"Europe/Warsaw",
			"Europe/Zagreb",
			"Europe/Zaporozhye",
			"Europe/Zurich",
			"Indian/Antananarivo",
			"Indian/Chagos",
			"Indian/Christmas",
			"Indian/Cocos",
			"Indian/Comoro",
			"Indian/Kerguelen",
			"Indian/Mahe",
			"Indian/Maldives",
			"Indian/Mauritius",
			"Indian/Mayotte",
			"Indian/Reunion",
			"Pacific/Apia",
			"Pacific/Auckland",
			"Pacific/Bougainville",
			"Pacific/Chatham",
			"Pacific/Chuuk",
			"Pacific/Easter",
			"Pacific/Efate",
			"Pacific/Enderbury",
			"Pacific/Fakaofo",
			"Pacific/Fiji",
			"Pacific/Funafuti",
			"Pacific/Galapagos",
			"Pacific/Gambier",
			"Pacific/Guadalcanal",
			"Pacific/Guam",
			"Pacific/Honolulu",
			"Pacific/Kiritimati",
			"Pacific/Kosrae",
			"Pacific/Kwajalein",
			"Pacific/Majuro",
			"Pacific/Marquesas",
			"Pacific/Midway",
			"Pacific/Nauru",
			"Pacific/Niue",
			"Pacific/Norfolk",
			"Pacific/Noumea",
			"Pacific/Pago_Pago",
			"Pacific/Palau",
			"Pacific/Pitcairn",
			"Pacific/Pohnpei",
			"Pacific/Port_Moresby",
			"Pacific/Rarotonga",
			"Pacific/Saipan",
			"Pacific/Tahiti",
			"Pacific/Tarawa",
			"Pacific/Tongatapu",
			"Pacific/Wake",
			"Pacific/Wallis"
		];
		if (W = +W, !(-90 <= (Y = +Y) && Y <= 90 && -180 <= W && W <= 180)) throw new RangeError("invalid coordinates");
		if (90 <= Y) return "Etc/GMT";
		var S = -1, V = 48 * (180 + W) / 360.00000000000006, X = 24 * (90 - Y) / 180.00000000000003, Z = 0 | V, M = 0 | X, G = 96 * M + 2 * Z;
		for (G = 56 * U.charCodeAt(G) + U.charCodeAt(G + 1) - 1995; G + T.length < 3136;) G = 56 * U.charCodeAt(G = 8 * (S = S + G + 1) + 4 * (M = 0 | (X = 2 * (X - M) % 2)) + 2 * (Z = 0 | (V = 2 * (V - Z) % 2)) + 2304) + U.charCodeAt(G + 1) - 1995;
		return T[G + T.length - 3136];
	}
	"undefined" != typeof module && (module.exports = tzlookup);
}));
//#endregion
//#region scripts/route-local.mjs
var HERE = path.dirname(fileURLToPath(import.meta.url));
var IN_REPO = fs.existsSync(path.join(HERE, "routing", "lib", "routeWorker.mjs"));
var DEFAULT_CHARTS = fs.existsSync(path.join(CHARTS_DIR, "index.json")) ? CHARTS_DIR : path.join(HERE, "charts");
var DEFAULT_CHARTS_URL = fs.existsSync(path.join(CHARTS_DIR, "index.json")) ? null : "https://wangap.fr/routing/charts/v1/";
var argv = process.argv.slice(2);
var arg = (k, d = null) => {
	const i = argv.indexOf(k);
	return i >= 0 ? argv[i + 1] : d;
};
var args = (k) => argv.flatMap((a, i) => a === k && argv[i + 1] ? [argv[i + 1]] : []);
var log = (...m) => console.log((/* @__PURE__ */ new Date()).toISOString().slice(11, 19), ...m);
/**
* POLAR-005 (D33) — `--polar fichier.json` : la polaire du calcul. Le PC du bord
* n'a pas la base : il garde la polaire EMBARQUÉE, sauf ce fichier (une version
* exportée du panneau ⛵ Polaires, ou le fichier du routeur). Vérifiée ; un
* fichier qui ne tient pas est REFUSÉ (jamais une route sur une table cassée).
*/
function polarFromFile(file) {
	const raw = JSON.parse(fs.readFileSync(file, "utf8"));
	const row = raw && typeof raw === "object" && raw.data && typeof raw.data === "object" && !raw.TWS_BINS ? raw : null;
	const data = row ? row.data : raw;
	const issue = polarShapeIssue(data);
	if (issue) throw Object.assign(/* @__PURE__ */ new Error(`--polar ${path.basename(file)} : ${issue}`), { code: "polar" });
	return withVersion(data, {
		id: row?.id || null,
		label: row?.label || path.basename(file),
		builtAt: row?.built_at || data.builtAt,
		source: "file"
	});
}
var POLAR_USED = polar_wangap_default;
/**
* D29 bis — LES FILS DU FICHIER UNIQUE : le fichier publié (public/routing/route-local/)
* se relance lui-même en worker_threads (`__thread` : 'route' | 'graph' — routeWorker.mjs
* et graphWorker.mjs y sont tous deux, seul celui demandé répond), au contrat de pool.mjs.
* Avant, sans fil : un seul cœur (la grille des départs y aurait pris des dizaines de minutes).
*/
function createSelfPool(file, workerData, size) {
	return createPool(new URL(import.meta.url), {
		...workerData,
		__thread: poolKind(file, workerData)
	}, size);
}
/** Les tuiles : le dossier local, et (en ligne) celles qui manquent téléchargées depuis wangap.fr et gardées. */
function chartStoreFor(dir = DEFAULT_CHARTS, url = DEFAULT_CHARTS_URL) {
	const local = fileChartStore(dir);
	if (!url) return local;
	const get = async (name) => {
		const f = path.join(dir, name.split("?")[0]);
		if (fs.existsSync(f)) return fs.readFileSync(f);
		const r = await fetch(new URL(name, url), { signal: AbortSignal.timeout(6e4) });
		if (!r.ok) throw Object.assign(/* @__PURE__ */ new Error(`cartes : ${r.status} ${name}`), { code: "no-charts" });
		const b = Buffer.from(await r.arrayBuffer());
		fs.mkdirSync(path.dirname(f), { recursive: true });
		fs.writeFileSync(f, b);
		return b;
	};
	return {
		index: async () => {
			try {
				const r = await fetch(new URL("index.json", url), { signal: AbortSignal.timeout(15e3) });
				const t = r.ok ? await r.text() : "";
				const j = t.trim().startsWith("{") ? JSON.parse(t) : null;
				if (j?.tiles) {
					fs.mkdirSync(dir, { recursive: true });
					fs.writeFileSync(path.join(dir, "index.json"), t);
					return j;
				}
			} catch {}
			return local.index();
		},
		tile: async (key, meta) => new Uint8Array(zlib.gunzipSync(await get(meta?.file || `t_${key}.wgt`))),
		tss: async (meta) => JSON.parse((await get(meta?.file || "tss.json")).toString("utf8"))
	};
}
var tzOf = async () => {
	try {
		const m = await Promise.resolve().then(() => /* @__PURE__ */ __toESM(require_tz(), 1));
		return async (lat, lon) => m.default(lat, lon);
	} catch {
		return async () => null;
	}
};
/** Une demande (le fichier de l'app, ou une demande nue) → la demande du moteur. */
function readRequest(text, { from = null } = {}) {
	const j = JSON.parse(text);
	const req = j.kind === "wangap-route-request" || j.request && !j.to ? j.request : j;
	if (!req?.to || !Number.isFinite(Number(req.to.lat))) throw new Error("demande sans arrivée (to.lat, to.lon)");
	const out = { ...req };
	if (!out.from || out.from === "bateau") {
		if (!from) throw new Error("départ « bateau » : hors ligne, donner --from lat,lon (ou préparer la demande depuis l'app en ligne)");
		out.from = {
			...from,
			kind: "bateau"
		};
	}
	return out;
}
/** Un paquet Open-Meteo pour la demande (en ligne) — les fonctions du service. */
async function openMeteoPack(request, days) {
	const bbox = passageBbox(request.from, request.to);
	const grids = {};
	let waves = null;
	waves = await fetchWaveGrid(bbox, {
		step: 1,
		days,
		log: (s) => log(s)
	});
	for (const m of Object.keys(MODELS)) try {
		grids[m] = await fetchWindGrid(m, bbox, {
			step: 1,
			days,
			log: (s) => log(s)
		});
	} catch (e) {
		log(`⚠ ${m} : ${e.message}`);
		if (e.code === "weather-quota") break;
	}
	return packFromGrids({
		grids,
		waves,
		bbox,
		days,
		name: "Open-Meteo (PC du bord)"
	});
}
/** D29 bis — la grille et son budget, de la ligne de commande (défaut : la grille complète, 240 s). */
var gridArg = () => [
	"off",
	"light",
	"full"
].includes(arg("--grid")) ? arg("--grid") : "full";
var budgetArg = () => {
	const s = Number(arg("--budget"));
	return Number.isFinite(s) && s > 0 ? Math.round(s * 1e3) : null;
};
/**
* Le calcul → l'enveloppe que l'app importe.
* Les fils : ceux du dépôt (worker_threads) ; le fichier publié, les siens (createSelfPool) ; --threads 1 : aucun.
*/
async function computeToEnvelope(request, pack, { charts, threads, nowMs, onStep, grid = gridArg(), departBudgetMs = budgetArg() } = {}) {
	const startedAt = (/* @__PURE__ */ new Date()).toISOString();
	const pool = threads === 1 ? createInProcessPool : IN_REPO ? null : createSelfPool;
	const result = await computeLocal(request, {
		pack,
		store: charts,
		threads: threads || Math.max(1, Math.min(4, os.availableParallelism() - 1)),
		nowMs: nowMs || Date.now(),
		computedOn: "boat-pc",
		grid,
		timezoneAt: await tzOf(),
		onStep,
		polar: POLAR_USED,
		...departBudgetMs ? { departBudgetMs } : {},
		...pool ? { createPool: pool } : {}
	});
	return {
		kind: ENVELOPE_KIND,
		v: 1,
		computedOn: "boat-pc",
		startedAt,
		finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
		request,
		result,
		weather: result.localWeather
	};
}
/**
* D29 bis — `--bench` : mesurer CE PC sur la météo fictive (D26 : sans paquet ni réseau),
* Gibraltar → Las Palmas — un processus par mesure (la mémoire au pic = la sienne).
* La même commande sur le Mac donne le rapport (ADR-0039 « D29 bis »).
*/
var BENCH = {
	a: {},
	b: { polar: true },
	c: {
		polar: true,
		crew: true
	},
	d: {
		polar: true,
		crew: true,
		bestDeparture: { windowH: 24 }
	},
	e: {
		polar: true,
		crew: true,
		bestDeparture: { windowH: 48 }
	}
};
async function benchOne(key) {
	const nowMs = Date.UTC(2026, 9, 27, 3);
	const request = {
		from: {
			...PLACES.gibraltar,
			kind: "point"
		},
		to: {
			...PLACES.laspalmas,
			kind: "point"
		},
		departMs: nowMs + 12 * 36e5,
		weatherSource: {
			source: "dummy",
			seed: 11,
			scenario: "trade"
		},
		options: BENCH[key],
		...BENCH[key].bestDeparture ? { when: {
			mode: "best",
			halfH: BENCH[key].bestDeparture.windowH / 2
		} } : {}
	};
	const charts = chartStoreFor(arg("--charts", DEFAULT_CHARTS), arg("--charts-url", DEFAULT_CHARTS_URL));
	const t0 = Date.now();
	const c0 = process.cpuUsage();
	const env = await computeToEnvelope(request, null, {
		charts,
		threads: Number(arg("--threads")) || null,
		nowMs,
		grid: key === "d" ? "light" : "full"
	});
	const cpu = process.cpuUsage(c0);
	const r = env.result;
	const bd = r.bestDeparture;
	const cells = bd ? bd.rows.flatMap((k) => bd.cells[k]) : [];
	console.log(`@@${JSON.stringify({
		key,
		ok: r.ok,
		s: Math.round((Date.now() - t0) / 100) / 10,
		cpuS: Math.round((cpu.user + cpu.system) / 1e5) / 10,
		maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
		grid: bd ? `${cells.filter((c) => c?.ok).length}/${cells.length}` : null,
		timedOut: bd?.timedOut ?? null
	})}`);
}
var benchKeys = () => {
	const v = argv[argv.indexOf("--bench") + 1] || "";
	return /^[a-e](,[a-e])*$/.test(v) ? v.split(",") : Object.keys(BENCH);
};
async function bench(keys) {
	log(`banc d'essai : ${os.cpus()[0]?.model || "?"} · ${os.availableParallelism()} fils · ${Math.round(os.totalmem() / 2 ** 30)} Go · node ${process.version}`);
	for (const k of keys) {
		const p = spawn(process.execPath, [
			fileURLToPath(import.meta.url),
			"--bench-one",
			k,
			...argv.filter((a, i) => a !== "--bench" && !(argv[i - 1] === "--bench" && /^[a-e](,[a-e])*$/.test(a)))
		], { stdio: [
			"ignore",
			"pipe",
			"inherit"
		] });
		let txt = "";
		p.stdout.on("data", (d) => {
			txt += d;
		});
		await new Promise((ok) => p.on("exit", ok));
		const line = txt.split("\n").find((l) => l.startsWith("@@"));
		const m = line ? JSON.parse(line.slice(2)) : null;
		log(m ? `${k} · ${m.s} s · CPU ${m.cpuS} s · mémoire au pic ${m.maxRssMB} Mo${m.grid ? ` · grille ${m.grid} (trop long ${m.timedOut})` : ""}` : `${k} : échec`);
	}
}
var slug = (s) => String(s || "route").normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "route";
var stamp = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace(/[:T]/g, "");
async function once() {
	const fromArg = arg("--from");
	const from = fromArg ? (([la, lo]) => ({
		lat: Number(la),
		lon: Number(lo),
		name: "Wang'ap"
	}))(fromArg.split(",")) : null;
	const request = readRequest(fs.readFileSync(arg("--request"), "utf8"), { from });
	let pack;
	if (args("--grib").length) {
		const { pack: p, report } = packFromGribFiles(args("--grib").map((f) => ({
			name: path.basename(f),
			bytes: new Uint8Array(fs.readFileSync(f))
		})));
		for (const m of report.models) log(`GRIB : ${m.label} · run ${m.run} · ${m.steps} échéances${m.gust ? "" : " · sans rafales"}`);
		if (!report.waves) log("⚠ pas de vagues dans le GRIB : la limite de vagues ne sera pas vérifiée");
		pack = p;
	} else if (arg("--pack")) pack = readPackFile(arg("--pack"));
	else if (argv.includes("--open-meteo")) pack = await openMeteoPack(request, Number(arg("--days", 10)));
	else if (normalizeWeatherSource(request.weatherSource).source !== "dummy") throw new Error("une météo : --grib, --pack ou --open-meteo (ou une demande en météo fictive)");
	const charts = chartStoreFor(arg("--charts", DEFAULT_CHARTS), arg("--charts-url", arg("--charts") && fs.existsSync(path.join(arg("--charts"), "index.json")) ? null : DEFAULT_CHARTS_URL));
	const env = await computeToEnvelope(request, pack, {
		charts,
		threads: Number(arg("--threads")) || null,
		nowMs: arg("--now") ? Date.parse(arg("--now")) : null,
		onStep: (s) => log("·", s.name, s.total ? `${s.done}/${s.total}` : "")
	});
	const out = arg("--out", `wangap-calcul-${slug(request.to?.name)}-${stamp()}.json`);
	fs.writeFileSync(out, JSON.stringify(env));
	const r = env.result;
	log(r.ok ? `✓ ${r.from.name} → ${r.to.name} · arrivée ${new Date(r.arrival.medianMs).toISOString()} · confiance ${r.confidence.level} · ${(JSON.stringify(env).length / 1024).toFixed(0)} Ko → ${out}` : `pas de route : ${r.reason} → ${out}`);
}
/**
* UN passage sur le dossier d'échange du PC : chaque demande déposée
* (wangap-demande-*.json) est calculée avec les GRIB du dossier (les plus
* récents) ou, à défaut, un paquet (.wgpack.json) ; le calcul s'écrit à côté
* (wangap-calcul-*.json), la demande passe dans traitees/ (avec un .erreur.txt
* si elle a échoué). → [{ demande, calcul?, erreur? }]
*/
async function processFolder(dir, { charts = chartStoreFor(), threads = null } = {}) {
	fs.mkdirSync(path.join(dir, "traitees"), { recursive: true });
	const done = [];
	for (const d of fs.readdirSync(dir).filter((f) => /^wangap-demande.*\.json$/i.test(f))) {
		const full = path.join(dir, d);
		try {
			const request = readRequest(fs.readFileSync(full, "utf8"));
			const gribs = fs.readdirSync(dir).filter((f) => /\.(grb2?|grib2?|gr2)$/i.test(f)).map((f) => ({
				f,
				t: fs.statSync(path.join(dir, f)).mtimeMs
			})).sort((x, y) => y.t - x.t);
			const packs = fs.readdirSync(dir).filter((f) => /\.wgpack(\.json)?(\.gz)?$/i.test(f));
			let pack;
			if (gribs.length) pack = packFromGribFiles(gribs.slice(0, 4).map(({ f }) => ({
				name: f,
				bytes: new Uint8Array(fs.readFileSync(path.join(dir, f)))
			}))).pack;
			else if (packs.length) pack = readPackFile(path.join(dir, packs.sort().pop()));
			else if (normalizeWeatherSource(request.weatherSource).source !== "dummy") {
				log(`${d} : en attente d'une météo (un GRIB dans le dossier)`);
				continue;
			}
			log(`${d} : calcul…`);
			const env = await computeToEnvelope(request, pack, {
				charts,
				threads
			});
			const out = path.join(dir, `wangap-calcul-${slug(request.to?.name)}-${stamp()}.json`);
			fs.writeFileSync(out, JSON.stringify(env));
			fs.renameSync(full, path.join(dir, "traitees", d));
			log(`✓ ${path.basename(out)}`);
			done.push({
				demande: d,
				calcul: path.basename(out)
			});
		} catch (e) {
			log(`✗ ${d} : ${e.message}`);
			fs.writeFileSync(path.join(dir, `${d}.erreur.txt`), `${e.code ? `[${e.code}] ` : ""}${e.message}\n`);
			fs.renameSync(full, path.join(dir, "traitees", d));
			done.push({
				demande: d,
				erreur: e.message
			});
		}
	}
	return done;
}
/** Le dossier d'échange, surveillé toutes les 5 s. */
async function watch(dir) {
	const charts = chartStoreFor(arg("--charts", DEFAULT_CHARTS), arg("--charts-url", arg("--charts") && fs.existsSync(path.join(arg("--charts"), "index.json")) ? null : DEFAULT_CHARTS_URL));
	let busy = false;
	const tick = async () => {
		if (busy) return;
		busy = true;
		try {
			await processFolder(dir, { charts });
		} finally {
			busy = false;
		}
	};
	setInterval(tick, 5e3);
	tick();
	log(`dossier d'échange : ${dir}`);
}
/** La page du réseau du bord : déposer (demande, GRIB), récupérer (calculs). */
function serve(dir, port) {
	const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;"
	})[c]);
	const page = () => {
		const files = fs.readdirSync(dir).filter((f) => /^wangap-calcul.*\.json$/i.test(f)).sort().reverse();
		const waiting = fs.readdirSync(dir).filter((f) => /^wangap-demande.*\.json$/i.test(f));
		const errs = fs.readdirSync(dir).filter((f) => /\.erreur\.txt$/.test(f)).slice(-5);
		return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wang'ap — routage du bord</title>
<style>body{font:16px system-ui;margin:16px;background:#F4F1DE;color:#1B2238}a{color:#16697A}li{margin:8px 0}.b{display:inline-block;padding:12px 16px;border-radius:12px;background:#16697A;color:#fff;font-weight:700}</style></head><body>
<h1>🖥️ Routage du PC du bord</h1>
<p>Déposer une demande (« Préparer pour le PC du bord » dans l'app) et un GRIB (NavimetriX), puis récupérer le calcul et l'importer dans l'app (🖥️ Importer un calcul du PC).</p>
<form id="f"><input type="file" id="i" multiple accept=".json,.grb,.grb2,.grib,.grib2,.gr2"> <button class="b">Déposer</button></form><p id="s"></p>
<h2>Calculs</h2><ul>${files.map((f) => `<li><a href="/f/${encodeURIComponent(f)}" download>${esc(f)}</a></li>`).join("") || "<li>aucun</li>"}</ul>
${waiting.length ? `<p>En attente : ${waiting.map(esc).join(", ")}</p>` : ""}${errs.map((f) => `<p>⚠ ${esc(f)} : ${esc(fs.readFileSync(path.join(dir, f), "utf8"))}</p>`).join("")}
<script>document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();const s=document.getElementById('s');for(const f of document.getElementById('i').files){s.textContent='envoi de '+f.name+'…';const r=await fetch('/up/'+encodeURIComponent(f.name),{method:'POST',body:f});s.textContent=r.ok?'déposé : '+f.name:'refusé ('+r.status+')';}setTimeout(()=>location.reload(),1500);};<\/script>
</body></html>`;
	};
	http.createServer((req, res) => {
		const u = new URL(req.url, "http://x");
		if (req.method === "GET" && u.pathname === "/") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(page());
			return;
		}
		if (req.method === "GET" && u.pathname.startsWith("/f/")) {
			const name = path.basename(decodeURIComponent(u.pathname.slice(3)));
			const f = path.join(dir, name);
			if (!/^wangap-calcul.*\.json$/i.test(name) || !fs.existsSync(f)) {
				res.writeHead(404);
				res.end();
				return;
			}
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Content-Disposition": `attachment; filename="${name}"`
			});
			fs.createReadStream(f).pipe(res);
			return;
		}
		if (req.method === "POST" && u.pathname.startsWith("/up/")) {
			const name = path.basename(decodeURIComponent(u.pathname.slice(4)));
			if (!/^[\w .()-]+\.(json|grb2?|grib2?|gr2)$/i.test(name)) {
				res.writeHead(400);
				res.end();
				return;
			}
			const chunks = [];
			let size = 0;
			req.on("data", (c) => {
				size += c.length;
				if (size > 64e6) req.destroy();
				else chunks.push(c);
			});
			req.on("end", () => {
				const dest = /\.json$/i.test(name) && !/^wangap-demande/i.test(name) ? `wangap-demande-${name}` : name;
				fs.writeFileSync(path.join(dir, dest), Buffer.concat(chunks));
				res.writeHead(200);
				res.end("ok");
			});
			return;
		}
		res.writeHead(404);
		res.end();
	}).listen(port, () => log(`page du bord : http://<adresse du PC>:${port}/ (réseau du bord seulement)`));
}
if (isMainThread && (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("route-local.mjs"))) try {
	if (arg("--polar")) {
		POLAR_USED = polarFromFile(arg("--polar"));
		log(`polaire : ${POLAR_USED.polarVersion.label} (${POLAR_USED.polarVersion.builtAt || "—"})`);
	}
	if (arg("--bench-one")) await benchOne(arg("--bench-one"));
	else if (argv.includes("--bench")) await bench(benchKeys());
	else if (arg("--watch")) {
		await watch(arg("--watch"));
		if (arg("--serve")) serve(arg("--watch"), Number(arg("--serve")));
	} else if (arg("--request")) await once();
	else {
		console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 37).join("\n"));
		process.exitCode = 2;
	}
} catch (e) {
	console.error(`✗ ${e.code ? `[${e.code}] ` : ""}${e.message}`);
	if (process.env.WANGAP_DEBUG) console.error(e.stack);
	process.exitCode = 1;
}
//#endregion
export { chartStoreFor, computeToEnvelope, createSelfPool, polarFromFile, processFolder, readRequest };
