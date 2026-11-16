"""Offline tests for stages 1-2 (no model calls): python -m unittest discover -s qwen-spatial-audit/tests"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qsa.geometry import page_to_px, px_to_page  # noqa: E402
from qsa.qwen_client import QwenClient, estimate_cost  # noqa: E402
from qsa.stage1 import tile_starts  # noqa: E402
from qsa.stage2 import (choose_convention, ink_bands, merge_tiles, parse_json_list, snap_to_bands,  # noqa: E402
                        validate_tile_items)
from qsa.validate import candidate, validate_lines  # noqa: E402


def page_with_rows(rows, w=400, h=400):
    """White image with black text-like bars at (y0, y1, x0, x1)."""
    img = np.full((h, w), 255, dtype=np.uint8)
    for y0, y1, x0, x1 in rows:
        img[y0:y1, x0:x1:3] = 0
    return img


TILE = {"id": "r00c00", "frame": {"scale": 300 / 72, "originX": 100.0, "originYTop": 50.0, "width": 400, "height": 400}}


class Geometry(unittest.TestCase):
    def test_round_trip(self):
        px = {"x": 40, "y": 80, "w": 120, "h": 30}
        b = px_to_page(px, TILE["frame"], 1728)
        self.assertAlmostEqual(b["x"], 100 + 40 / (300 / 72))
        self.assertAlmostEqual(b["y"] + b["height"], 1728 - (50 + 80 / (300 / 72)))
        back = page_to_px(b, TILE["frame"], 1728)
        for k in ("x", "y", "w", "h"):
            self.assertAlmostEqual(back[k], px[k])

    def test_tiles_cover_page_with_overlap(self):
        s = tile_starts(10800, 980, 140)
        self.assertEqual(s[0], 0)
        self.assertEqual(s[-1] + 980, 10800)
        self.assertTrue(all(b - a <= 840 for a, b in zip(s, s[1:])))


class Parsing(unittest.TestCase):
    def test_fenced_list(self):
        items, status = parse_json_list('```json\n[{"bbox_2d":[1,2,3,4],"text_content":"A"}]\n```')
        self.assertEqual((len(items), status), (1, "ok"))

    def test_truncated_reply_keeps_complete_objects(self):
        items, status = parse_json_list('[{"bbox_2d":[1,2,30,40],"text_content":"3\'-6\\" MIN"},{"bbox_2d":[5,6')
        self.assertEqual(status, "recovered")
        self.assertEqual(items[0]["text_content"], "3'-6\" MIN")


class Validation(unittest.TestCase):
    def test_text_is_never_rewritten_and_empty_box_rejected(self):
        img = page_with_rows([(100, 130, 20, 300)])
        raw = [{"bbox_2d": [20, 100, 300, 130], "text_content": "1O DEGREES", "uncertain": True, "alternatives": ["10 DEGREES"]},
               {"bbox_2d": [20, 300, 300, 330], "text_content": "GHOST"}]
        kept, rep = validate_tile_items(raw, img, TILE, 1728)
        self.assertEqual([k["text"] for k in kept], ["1O DEGREES"])
        self.assertEqual(kept[0]["alternatives"], ["10 DEGREES"])
        self.assertEqual(rep["rejected"][0]["reason"], "no_ink_under_box")

    def test_normalized_coordinates_detected_by_ink(self):
        img = page_with_rows([(200, 230, 200, 380)], w=800, h=800)
        raw = [{"bbox_2d": [250, 250, 475, 287], "text_content": "X"}]
        conv, scores = choose_convention(raw, img)
        self.assertEqual(conv, "norm1000")

    def test_band_alignment_undoes_pitch_drift(self):
        rows = [(40 + 45 * i, 72 + 45 * i, 20, 300) for i in range(8)]
        img = page_with_rows(rows, h=420)
        model = [[20, 40 + 38 * i, 300, 72 + 38 * i] for i in range(8)]  # model pitch 38 px, printed 45 px
        snaps = snap_to_bands(model, img)
        self.assertEqual([round(s["y0"]) for s in snaps], [r[0] for r in rows])

    def test_auto_snaps_only_misaligned_tiles(self):
        rows = [(40 + 45 * i, 72 + 45 * i, 20, 300) for i in range(8)]
        img = page_with_rows(rows, h=420)
        item = lambda b: {"bbox_2d": b, "text_content": "ROW"}  # noqa: E731
        aligned = [item([20, r[0], 300, r[1]]) for r in rows]
        drifted = [item([20, 40 + 38 * i, 300, 72 + 38 * i]) for i in range(8)]
        self.assertFalse(validate_tile_items(aligned, img, TILE, 1728, snap="auto")[1]["snapped"])
        self.assertTrue(validate_tile_items(drifted, img, TILE, 1728, snap="auto")[1]["snapped"])

    def test_touching_rows_split_into_bands(self):
        img = page_with_rows([(10, 50, 0, 200), (50, 92, 0, 200)])
        img[50, :] = 255
        self.assertEqual(len(ink_bands(img, 0, 200)), 2)


class Merge(unittest.TestCase):
    def read(self, tile, text, x, edge, k=0):
        return {"tileId": tile, "k": k, "text": text, "category": "note", "group": None, "uncertain": False, "alternatives": [],
                "px": {}, "box": {"x": x, "y": 100, "width": 80, "height": 8}, "modelBox": {"x": x, "y": 100, "width": 80, "height": 8},
                "snapShiftPx": None, "edgeDistancePx": edge, "flags": ["tile_edge"] if edge < 6 else []}

    def test_cut_reading_absorbed_and_full_disagreement_kept(self):
        lines = merge_tiles([self.read("a", "DOOR 5 RESTROOM EXTERIOR", 10, 200), self.read("b", "DOOR 5 RESTROOM EXTERIC", 10, 2)])
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["text"], "DOOR 5 RESTROOM EXTERIOR")
        self.assertFalse(lines[0]["conflict"])
        lines = merge_tiles([self.read("a", "70 DEGREES", 10, 200), self.read("b", "10 DEGREES", 10, 150)])
        self.assertTrue(lines[0]["conflict"])
        self.assertEqual(lines[0]["alternatives"], ["10 DEGREES"])


class ValueValidation(unittest.TestCase):
    def cand(self, text, i=0):
        c = candidate(text.split(), i)
        return c[0] if c else None

    def test_lookalike_candidates_only_in_numeric_context(self):
        self.assertEqual(self.cand('I-1/4"'), '1-1/4"')
        self.assertEqual(self.cand("A-3.0I"), "A-3.01")
        self.assertEqual(self.cand("IOIB"), "101B")
        self.assertEqual(self.cand("SI 0.43"), "S1")
        for word in ["IO", "I-BEAM", "O.C.", "A-I.OI"]:
            self.assertIsNone(self.cand(word), word)
        self.assertIsNone(self.cand("CLASS I", 1))

    def line(self, text, extra=None):
        return {"lid": "L0", "text": text, "box": {"x": 100, "y": 100, "width": 80, "height": 10}, "conflict": False,
                "alternatives": [], "uncertain": False, "provenance": [{"tileId": "a", "text": text}], **(extra or {})}

    def test_unresolved_ambiguity_is_flagged_not_rewritten(self):
        l = self.line("A-4.0I")
        validate_lines([l], {"textLayer": {"words": []}})
        self.assertEqual(l["text"], "A-4.0I")
        self.assertTrue(l["uncertain"])
        self.assertEqual(l["valueChecks"][0]["status"], "flagged_ambiguous")

    def test_overlap_tile_reading_corrects_and_keeps_original(self):
        l = self.line("A-30I", {"provenance": [{"tileId": "a", "text": "A-30I"}, {"tileId": "b", "text": "A-301"}]})
        validate_lines([l], {"textLayer": {"words": []}})
        self.assertEqual((l["text"], l["ocrText"]), ("A-301", "A-30I"))
        self.assertEqual(l["valueChecks"][0]["status"], "corrected_overlap_tile")

    def test_text_layer_confirms_or_corrects(self):
        words = [{"text": "A-3.01", "box": {"x": 105, "y": 101, "width": 40, "height": 8}}]
        l = self.line("A-3.0I")
        validate_lines([l], {"textLayer": {"words": words}})
        self.assertEqual(l["text"], "A-3.01")
        self.assertEqual(l["valueChecks"][0]["status"], "corrected_text_layer")


class Budget(unittest.TestCase):
    def test_paid_backend_needs_approval(self):
        with self.assertRaises(PermissionError):
            QwenClient("openrouter-72b")

    def test_estimate(self):
        e = estimate_cost("openrouter-72b", [(980, 980)], 1000)
        self.assertEqual(e["inputTokens"], 35 * 35 + 420)
        self.assertAlmostEqual(e["usd"], round((1645 * 0.8 + 1000 * 1.0) / 1e6, 4))


if __name__ == "__main__":
    unittest.main()
