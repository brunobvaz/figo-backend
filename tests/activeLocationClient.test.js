import { afterEach, expect, it, vi } from 'vitest';
import { deviceLocation, locationCoordinates, locationLabel, locationRegion, profileLocation } from '../../mobile/src/utils/activeLocation.js';
import { productQuery } from '../../mobile/src/utils/exploreFilters.js';

const nativeLocation = () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  requestForegroundPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  hasServicesEnabledAsync: vi.fn().mockResolvedValue(true),
  getCurrentPositionAsync: vi.fn().mockResolvedValue({ coords: { latitude: 41.18, longitude: -8.68 } }),
  reverseGeocodeAsync: vi.fn().mockResolvedValue([{ city: 'Matosinhos', district: 'Leça da Palmeira' }]),
});
afterEach(() => vi.useRealTimers());
it('mostra apenas o concelho do perfil, sem código postal', () => {
  const profile = profileLocation({ municipality: 'Chaves', parish: 'Santa Maria Maior', city: 'Chaves', postalCode: '5400-629', geo: { coordinates: [-7.47, 41.74] } });
  expect(locationLabel(profile)).toBe('Chaves');
  expect(locationCoordinates(profile)).toEqual({ latitude: 41.74, longitude: -7.47 });
  expect(locationLabel(profileLocation('Chaves · 5400-629'))).toBe('Chaves');
  expect(locationLabel(profileLocation(null))).toBe('Definir localização');
});
it('ignora coordenadas inválidas e permite pesquisa estruturada sem GPS', () => {
  const profile = profileLocation({ municipality: 'Chaves', municipalityCode: '1703', parishCode: '170301', geo: { coordinates: [-7, 100] } });
  expect(locationCoordinates(profile)).toBeNull();
  expect(locationRegion(profile)).toEqual({ municipalityCode: '1703', parishCode: '170301' });
  expect(productQuery({ sortBy: 'distance', radiusKm: 10 }, null, locationRegion(profile))).toMatchObject({ municipalityCode: '1703', parishCode: '170301', sort: 'recent', radiusKm: undefined });
});
it('usa o dispositivo e a mesma referência na consulta de proximidade', async () => {
  const native = nativeLocation();
  const device = { ...await deviceLocation(native), source: 'device' };
  expect(locationLabel(device)).toBe('Matosinhos');
  expect(native.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(productQuery({ sortBy: 'distance', radiusKm: 10 }, locationCoordinates(device))).toMatchObject({ latitude: 41.18, longitude: -8.68, radiusKm: 10, sort: 'distance' });
});
it('só pede permissão numa escolha explícita', async () => {
  const native = nativeLocation();
  native.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  await expect(deviceLocation(native, { requestPermission: false })).rejects.toThrow();
  expect(native.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(native.getCurrentPositionAsync).not.toHaveBeenCalled();
  await deviceLocation(native);
  expect(native.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
});
it('rejeita permissão negada sem consultar coordenadas', async () => {
  const native = nativeLocation();
  native.getForegroundPermissionsAsync.mockResolvedValue({ granted: false });
  native.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false });
  await expect(deviceLocation(native)).rejects.toThrow();
  expect(native.getCurrentPositionAsync).not.toHaveBeenCalled();
});
it('não volta a pedir quando o sistema impede novas perguntas', async () => {
  const native = nativeLocation();
  native.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
  await expect(deviceLocation(native)).rejects.toThrow();
  expect(native.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});
it('trata serviços desativados e falha de GPS', async () => {
  const native = nativeLocation();
  native.hasServicesEnabledAsync.mockResolvedValue(false);
  await expect(deviceLocation(native)).rejects.toThrow();
  native.hasServicesEnabledAsync.mockResolvedValue(true);
  native.getCurrentPositionAsync.mockRejectedValue(new Error('GPS indisponível'));
  await expect(deviceLocation(native)).rejects.toThrow('GPS indisponível');
});
it('mantém coordenadas quando não consegue resolver um nome', async () => {
  const native = nativeLocation();
  native.reverseGeocodeAsync.mockRejectedValue(new Error('Offline'));
  const device = { ...await deviceLocation(native), source: 'device' };
  expect(locationCoordinates(device)).toEqual({ latitude: 41.18, longitude: -8.68 });
  expect(locationLabel(device)).toBe('Localização atual');
});
it('limita o tempo de espera por GPS', async () => {
  vi.useFakeTimers();
  const native = nativeLocation();
  native.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
  const result = expect(deviceLocation(native)).rejects.toThrow('a tempo');
  await vi.advanceTimersByTimeAsync(15000);
  await result;
});
