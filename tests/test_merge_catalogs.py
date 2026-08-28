import unittest

from satellite_catalog.merge_catalogs import merge_catalogs


class MergeCatalogsTest(unittest.TestCase):
    def test_deduplicates_by_id_and_signature_while_preserving_order(self):
        documents = [
            {"source_root": "new", "scenes": [
                {"id": "new-1", "signature": "sig-1", "folder": "new"},
                {"id": "new-2", "signature": "sig-2", "folder": "new"},
            ]},
            {"source_root": "legacy", "scenes": [
                {"id": "new-1", "signature": "different", "folder": "old"},
                {"id": "old-copy", "signature": "sig-2", "folder": "old"},
                {"id": "old-3", "signature": "sig-3", "folder": "old"},
            ]},
        ]

        from pathlib import Path
        from tempfile import TemporaryDirectory
        import json

        with TemporaryDirectory() as directory:
            paths = []
            for index, document in enumerate(documents):
                path = Path(directory, f"{index}.json")
                path.write_text(json.dumps(document), "utf-8")
                paths.append(path)
            result = merge_catalogs(paths)

        self.assertEqual([scene["id"] for scene in result["scenes"]], ["new-1", "new-2", "old-3"])
        self.assertEqual(result["source_roots"], ["new", "legacy"])


if __name__ == "__main__":
    unittest.main()
