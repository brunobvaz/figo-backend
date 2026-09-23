import { resolveLocation } from './locationService.js';

// Reuse the same authoritative parish reference points as product adverts.
// The event's location remains the editor's free text, not a composed address.
export async function resolveEventLocation(input, current) {
  const { municipalityCode, parishCode, ...fields } = input;
  if (municipalityCode !== undefined) {
    try {
      const resolved = await resolveLocation({
        municipalityCode, parishCode, locality: input.location ?? current?.location
      });
      return { ...fields, address: resolved.address, geo: resolved.geo, locationSource: resolved.locationSource };
    } catch (error) {
      if (['INVALID_LOCATION', 'PARISH_POINT_UNAVAILABLE'].includes(error.code))
        error.details = [{ field: 'parishCode', message: error.message }];
      throw error;
    }
  }
  // A partial edit of the locality does not change the selected reference point.
  if (input.location !== undefined && current?.address) {
    const address = current.address.toObject();
    return { ...fields, address: { ...address, locality: input.location } };
  }
  return fields;
}
