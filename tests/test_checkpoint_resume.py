import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from satellite_catalog.cli import build, iter_rasters, write_json_atomic


class CheckpointResumeTest(unittest.TestCase):
    def test_atomic_json_write_retries_a_transient_windows_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory, "catalog.json")
            real_replace = __import__("os").replace
            attempts = 0

            def locked_twice(source, destination):
                nonlocal attempts
                attempts += 1
                if attempts < 3:
                    raise PermissionError(5, "Access is denied")
                return real_replace(source, destination)

            with patch("satellite_catalog.cli.os.replace", side_effect=locked_twice), patch(
                "satellite_catalog.cli.time.sleep"
            ):
                write_json_atomic(output, {"ok": True})

            self.assertEqual(attempts, 3)
            self.assertEqual(json.loads(output.read_text()), {"ok": True})

    def test_ecw_files_are_discovered_case_insensitively(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "nested").mkdir()
            expected = root / "nested" / "sample.ECW"
            expected.write_bytes(b"ecw placeholder")
            (root / "ignore.txt").write_text("not a raster")

            self.assertEqual(list(iter_rasters(root)), [expected])

    def test_interruption_preserves_completed_files_and_resumes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory, "source")
            root.mkdir()
            first = root / "BJ3A1_PMS1_20250729031315_L2_FIRST-FUS.tif"
            second = root / "BJ3A1_PMS1_20250729031317_L2_SECOND-FUS.tif"
            first.write_bytes(b"first raster")
            second.write_bytes(b"second raster")
            output = Path(directory, "catalog.json")
            cache = Path(directory, "cache.json")
            previews = Path(directory, "previews")
            calls = []

            def interrupt_second(path, *_):
                calls.append(path.name)
                if path == second:
                    raise KeyboardInterrupt
                return {"metadata_status": "geospatial", "preview": "first.jpg"}

            with patch("satellite_catalog.cli.raster_metadata", side_effect=interrupt_second):
                with self.assertRaises(KeyboardInterrupt):
                    build(root, output, previews, cache)

            partial = Path(directory, "catalog.partial.json")
            self.assertTrue(cache.exists())
            self.assertTrue(partial.exists())
            self.assertFalse(output.exists())
            self.assertEqual(len(json.loads(cache.read_text())), 1)
            self.assertEqual(json.loads(partial.read_text())["summary"]["scene_count"], 1)

            resumed_calls = []

            def complete_remaining(path, *_):
                resumed_calls.append(path.name)
                return {"metadata_status": "geospatial", "preview": f"{path.stem}.jpg"}

            with patch("satellite_catalog.cli.raster_metadata", side_effect=complete_remaining):
                result = build(root, output, previews, cache)

            self.assertEqual(result["summary"]["scene_count"], 2)
            self.assertEqual(resumed_calls, [second.name])
            self.assertTrue(output.exists())
            self.assertFalse(partial.exists())
            self.assertEqual(result["build_status"], "complete")


if __name__ == "__main__":
    unittest.main()
