import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';
export async function activeVersion() {
  const dataset = await mongoose.connection.db.collection('referenceDatasets').findOne({ _id: 'caop' });
  if (!dataset) throw new AppError(503, 'LOCATIONS_NOT_READY', 'As localizações ainda não foram importadas.');
  return dataset.activeVersion;
}
export async function resolveLocation(input) {
  if (!input.municipalityCode) return input;
  const { municipalityCode, parishCode, locality, latitude, longitude, locationSource, ...other } = input;
  const version = await activeVersion();
  const db = mongoose.connection.db;
  const [municipality, parish] = await Promise.all([
    db.collection('municipalities').findOne({ version, code: municipalityCode }),
    db.collection('parishes').findOne({ version, code: parishCode, municipalityCode })
  ]);
  if (!municipality || !parish) throw new AppError(422, 'INVALID_LOCATION', 'A freguesia não pertence ao concelho selecionado.');
  const point = parish;
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
      || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) {
    throw new AppError(422, 'PARISH_POINT_UNAVAILABLE', 'A freguesia ainda não tem um ponto de referência. Tenta novamente mais tarde.');
  }
  return { ...other, address: { municipalityCode, parishCode, locality, municipality: municipality.name, parish: parish.name, version },
    location: `${locality}, ${parish.name}, ${municipality.name}`, geo: { type: 'Point', coordinates: [point.longitude, point.latitude] }, locationSource: 'parish' };
}

export async function resolveUserLocation(location) {
  if (!location.municipalityCode) return location;
  const resolved = await resolveLocation(location);
  return { ...resolved.address, geo: resolved.geo, city: `${resolved.address.parish}, ${resolved.address.municipality}` };
}
