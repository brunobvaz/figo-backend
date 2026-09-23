import mongoose from 'mongoose';

// Small, deterministic catalogue for disposable test databases only.
export const eventLocationInput = { municipalityCode: '0407', parishCode: '040701' };
export const eventLocation = locality => ({
  address: { ...eventLocationInput, municipality: 'Mirandela', parish: 'Abambres', locality, version: 'CAOP-test' },
  geo: { type: 'Point', coordinates: [-7.18, 41.48] },
  locationSource: 'parish'
});
export async function seedEventLocations() {
  const db = mongoose.connection.db;
  await Promise.all(['referenceDatasets', 'municipalities', 'parishes'].map(name => db.collection(name).deleteMany({})));
  await db.collection('referenceDatasets').insertOne({ _id: 'caop', activeVersion: 'CAOP-test' });
  await db.collection('municipalities').insertMany([
    { code: '0407', name: 'Mirandela', version: 'CAOP-test' },
    { code: '0302', name: 'Barcelos', version: 'CAOP-test' }
  ]);
  await db.collection('parishes').insertMany([
    { municipalityCode: '0407', code: '040701', name: 'Abambres', version: 'CAOP-test', latitude: 41.48, longitude: -7.18 },
    { municipalityCode: '0407', code: '040702', name: 'Abreiro', version: 'CAOP-test', latitude: 41.35, longitude: -7.28 },
    { municipalityCode: '0302', code: '0302FA', name: 'Freguesia de teste', version: 'CAOP-test', latitude: 41.5, longitude: -8.6 }
  ]);
}
