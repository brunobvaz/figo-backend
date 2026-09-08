"""Convert the official CAOP2025 ZIP to the bundled domain JSON files.
Usage: python3 scripts/prepare-caop.py /path/to/Areas_Freg_Mun_Dist_Pais_CAOP2025.zip
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

archive = Path(sys.argv[1]).read_bytes()
outer = zipfile.ZipFile(io.BytesIO(archive))
inner = zipfile.ZipFile(io.BytesIO(outer.read('Areas_Freg_Mun_Dist_Pais_CAOP2025_csv.zip')))
def rows(name):
    return list(csv.DictReader(io.StringIO(inner.read(name).decode('utf-8-sig')), delimiter=';'))
municipalities = [dict(code=r['dtmn'], name=r['município_dsg'], region=r['nuts1_dsg']) for r in rows('Areas_Municipio_CAOP2025.csv')]
parishes = [dict(code=r['dtmnfr'], name=r['freguesia_dsg'], municipalityCode=r['dtmnfr'][:4]) for r in rows('Areas_Freguesia_CAOP2025.csv')]
assert len(municipalities) == 308 and len(parishes) == 3259
municipality_names = {r['code']: r['name'] for r in municipalities}
assert all(municipality_names[r['dtmnfr'][:4]] == r['município_dsg'] for r in rows('Areas_Freguesia_CAOP2025.csv'))
output = Path(__file__).resolve().parent.parent / 'data/caop/2025'
output.mkdir(parents=True, exist_ok=True)
source = dict(version='CAOP2025', url='https://www.dgterritorio.gov.pt/sites/default/files/ficheiros-cartografia/Areas_Freg_Mun_Dist_Pais_CAOP2025.zip', sha256=hashlib.sha256(archive).hexdigest(), municipalities=308, parishes=3259)
for name, data in [('municipalities', municipalities), ('parishes', parishes), ('source', source)]:
    (output / f'{name}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('CAOP2025 convertida e relações administrativas verificadas.')
