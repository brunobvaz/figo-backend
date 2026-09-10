"""Enrich CAOP2025 using DGT geometries. Requires shapely and pyproj.
Usage: python prepare-parish-points.py mainland.geojson azores.zip madeira.zip
The GeoJSON is from /collections/freguesias/items?f=json&limit=4000 on
https://ogcapi.dgterritorio.gov.pt; island ZIPs are official CAOP2025 GPKGs.
"""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import zipfile
from shapely.geometry import shape
from shapely import from_wkb
from pyproj import Transformer

root = Path(__file__).resolve().parent.parent / 'data/caop/2025'
parishes = json.loads((root / 'parishes.json').read_text())
points = {}
def add(code, geometry, srs):
    assert code not in points, f'Duplicate parish: {code}'
    assert not geometry.is_empty and geometry.is_valid, f'Invalid geometry: {code}'
    # Prefer the largest land component, avoiding small offshore fragments.
    polygon = max(geometry.geoms, key=lambda g: g.area) if geometry.geom_type == 'MultiPolygon' else geometry
    point = polygon.representative_point()
    assert geometry.contains(point), code
    longitude, latitude = Transformer.from_crs(srs, 4326, always_xy=True).transform(point.x, point.y)
    assert -32 < longitude < -6 and 30 < latitude < 43, code
    points[code] = dict(latitude=latitude, longitude=longitude)

mainland = json.loads(Path(sys.argv[1]).read_text())
assert len(mainland['features']) == mainland['numberMatched'], 'Incomplete GeoJSON download'
for feature in mainland['features']:
    add(feature['properties']['dtmnfr'], shape(feature['geometry']), 4326)
with tempfile.TemporaryDirectory() as temp:
    for archive in sys.argv[2:]:
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                if not name.endswith('.gpkg'): continue
                path = Path(temp) / Path(name).name
                path.write_bytes(z.read(name))
                with sqlite3.connect(path) as db:
                    for table, column, srs in db.execute('select table_name,column_name,srs_id from gpkg_geometry_columns').fetchall():
                        if not table.endswith('_freguesias'): continue
                        for code, blob in db.execute(f'SELECT dtmnfr, "{column}" FROM "{table}"'):
                            assert blob[:2] == b'GP'
                            envelope = (blob[3] >> 1) & 7
                            offset = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]
                            add(code, from_wkb(blob[offset:]), srs)
expected = {p['code'] for p in parishes}
assert expected == set(points), f'Missing {expected-set(points)}; extra {set(points)-expected}'
for parish in parishes: parish.update(points[parish['code']])
(root / 'parishes.json').write_text(json.dumps(parishes, ensure_ascii=False, indent=2) + '\n')
metadata = dict(version='CAOP2025', method='representative_point of largest polygon; WGS84 longitude/latitude', count=len(points),
    sources=[dict(url=url, sha256=hashlib.sha256(Path(file).read_bytes()).hexdigest()) for file,url in zip(sys.argv[1:],[
        'https://ogcapi.dgterritorio.gov.pt/collections/freguesias/items?f=json&limit=4000',
        'https://geo2.dgterritorio.gov.pt/caop/CAOP_RAA_2025-gpkg.zip',
        'https://geo2.dgterritorio.gov.pt/caop/CAOP_RAM_2025-gpkg.zip'])])
(root / 'points-source.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(f'{len(points)} parish points verified inside official boundaries.')
