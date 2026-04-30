import unittest

from app.diff_utils import find_changed_clauses, split_into_clauses


class DiffUtilsTests(unittest.TestCase):
    def test_split_into_indonesian_pasal_clauses_with_offsets(self):
        text = "Pembuka\n\nPasal 1\nPara pihak sepakat untuk bekerja sama.\n\nPasal 2\nPembayaran dilakukan dalam 30 hari."

        clauses = split_into_clauses(text)

        self.assertEqual([clause["identifier"] for clause in clauses], ["Pasal 1", "Pasal 2"])
        self.assertTrue(text[clauses[0]["start_char"]:clauses[0]["end_char"]].startswith("Pasal 1"))

    def test_find_changed_clauses_detects_modified_clause(self):
        v1 = "Pasal 1\nPembayaran dilakukan dalam tiga puluh hari setelah invoice diterima dan tanpa penalti.\n\nPasal 2\nPerjanjian berlaku satu tahun."
        v2 = "Pasal 1\nPembayaran hanya dilakukan setelah seluruh pekerjaan disetujui sepihak oleh pembeli.\n\nPasal 2\nPerjanjian berlaku satu tahun."

        changed = find_changed_clauses(v1, v2)

        self.assertEqual(len(changed), 1)
        self.assertEqual(changed[0]["identifier"], "Pasal 1")
        self.assertEqual(changed[0]["change_type"], "modified")
        self.assertIn("disetujui sepihak", changed[0]["v2_text"])

    def test_find_changed_clauses_detects_added_and_removed(self):
        v1 = "Section 1\nOld clause remains long enough to parse.\n\nSection 2\nRemoved clause text long enough to parse."
        v2 = "Section 1\nOld clause remains long enough to parse.\n\nSection 3\nAdded clause text long enough to parse."

        changed = find_changed_clauses(v1, v2)
        change_types = {item["identifier"]: item["change_type"] for item in changed}

        self.assertEqual(change_types["Section 2"], "removed")
        self.assertEqual(change_types["Section 3"], "added")


if __name__ == "__main__":
    unittest.main()
