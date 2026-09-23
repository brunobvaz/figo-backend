import { afterEach, expect, it, vi } from 'vitest';
import { mountClient } from './helpers/mountClient.js';
import { eventCoordinates, eventDirectionsUrl } from '../../mobile/src/utils/eventDirections.js';

const event = { id: 'event', geo: { type: 'Point', coordinates: [-7.18, 41.48] }, locationSource: 'parish' };
const origin = { latitude: 41.18, longitude: -8.68 };
const nativeLocation = () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  requestForegroundPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  hasServicesEnabledAsync: vi.fn().mockResolvedValue(true),
  getCurrentPositionAsync: vi.fn().mockResolvedValue({ coords: origin }),
  reverseGeocodeAsync: vi.fn()
});
function mount(platform = 'ios', location = nativeLocation()) {
  const openURL = vi.fn().mockResolvedValue(undefined);
  const hook = mountClient('src/hooks/useEventDirections.js', ['event'], {
    'react-native': { Linking: { openURL }, Platform: { OS: platform } },
    'expo-location': location
  });
  return { hook, location, openURL };
}
afterEach(() => vi.useRealTimers());

it('valida destinos GeoJSON, incluindo longitude/latitude na ordem correta e coordenadas zero', () => {
  expect(eventCoordinates(event)).toEqual({ latitude: 41.48, longitude: -7.18 });
  expect(eventCoordinates({ geo: { type: 'Point', coordinates: [0, 0] } })).toEqual({ latitude: 0, longitude: 0 });
  for (const geo of [null, {}, { type: 'LineString', coordinates: [-7, 41] },
    { type: 'Point', coordinates: [-7, 41, 0] }, { type: 'Point', coordinates: ['-7', 41] },
    { type: 'Point', coordinates: [Infinity, 41] }, { type: 'Point', coordinates: [-7, 91] }])
    expect(eventCoordinates({ geo })).toBeNull();
  expect(() => eventDirectionsUrl({ latitude: 91, longitude: 0 }, origin, 'ios')).toThrow();
});

it.each(['ios', 'android'])('abre direções em %s com GPS atual, distância a calcular no mapa e sem pesquisa por morada', async platform => {
  const { hook, location, openURL } = mount(platform);
  expect(location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  await hook.value.open(event);
  expect(location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3 });
  expect(location.reverseGeocodeAsync).not.toHaveBeenCalled();
  expect(openURL).toHaveBeenCalledOnce();
  const url = new URL(openURL.mock.calls[0][0]);
  expect(url.protocol).toBe('https:');
  expect(url.hostname).toBe(platform === 'ios' ? 'maps.apple.com' : 'www.google.com');
  expect(url.searchParams.get(platform === 'ios' ? 'saddr' : 'origin')).toBe('41.18,-8.68');
  expect(url.searchParams.get(platform === 'ios' ? 'daddr' : 'destination')).toBe('41.48,-7.18');
  expect(url.searchParams.get(platform === 'ios' ? 'dirflg' : 'travelmode')).toBe(platform === 'ios' ? 'd' : 'driving');
  expect(hook.value).toMatchObject({ pending: false, error: '' });
  hook.unmount();
});

it('pede autorização apenas ao tocar e permite definir origem no mapa após recusa', async () => {
  const { hook, location, openURL } = mount('android');
  location.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false });
  await hook.value.open(event);
  expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
  expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(openURL).not.toHaveBeenCalled();
  expect(hook.value).toMatchObject({ pending: false, chooseOrigin: true });
  expect(hook.value.error).toContain('localização');
  await hook.value.open(event, { chooseOrigin: true });
  expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
  const url = new URL(openURL.mock.calls[0][0]);
  expect(url.searchParams.has('origin')).toBe(false);
  expect(url.searchParams.get('destination')).toBe('41.48,-7.18');
  hook.unmount();
});

it.each(['denied', 'disabled', 'invalid', 'timeout'])('permite recuperar quando GPS/autorização falha: %s', async failure => {
  vi.useFakeTimers();
  const { hook, location, openURL } = mount();
  if (failure === 'denied') location.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
  if (failure === 'disabled') location.hasServicesEnabledAsync.mockResolvedValue(false);
  if (failure === 'invalid') location.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 100, longitude: 0 } });
  if (failure === 'timeout') location.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
  const task = hook.value.open(event);
  await vi.advanceTimersByTimeAsync(failure === 'timeout' ? 15000 : 0);
  await task;
  expect(openURL).not.toHaveBeenCalled();
  expect(hook.value).toMatchObject({ pending: false, chooseOrigin: true });
  expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  location.getForegroundPermissionsAsync.mockResolvedValue({ granted: true });
  location.hasServicesEnabledAsync.mockResolvedValue(true);
  location.getCurrentPositionAsync.mockResolvedValue({ coords: origin });
  await hook.value.open(event);
  expect(openURL).toHaveBeenCalledOnce();
  hook.unmount();
});

it('bloqueia cliques repetidos e ignora GPS tardio depois de sair do detalhe', async () => {
  const { hook, location, openURL } = mount();
  let finish;
  location.getCurrentPositionAsync.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const task = hook.value.open(event);
  await hook.value.open(event);
  await vi.waitFor(() => expect(location.getCurrentPositionAsync).toHaveBeenCalledOnce());
  expect(hook.value.pending).toBe(true);
  hook.focus(false);
  finish({ coords: origin });
  await task;
  expect(openURL).not.toHaveBeenCalled();
  hook.unmount();
});

it('não cancela a ação por a app ficar temporariamente inativa durante o pedido de permissão', async () => {
  const { hook, location, openURL } = mount();
  location.getForegroundPermissionsAsync.mockResolvedValue({ granted: false });
  let finish;
  location.requestForegroundPermissionsAsync.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const task = hook.value.open(event);
  await vi.waitFor(() => expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce());
  hook.appState('inactive');
  finish({ granted: true });
  hook.appState('active');
  await task;
  expect(openURL).toHaveBeenCalledOnce();
  hook.unmount();
});

it('tolera a ausência do Mapas da Apple e permite repetir falhas ao abrir ambos os serviços', async () => {
  const { hook, openURL } = mount();
  openURL.mockRejectedValue(new Error('Não existe handler'));
  await hook.value.open(event);
  expect(openURL).toHaveBeenCalledTimes(2);
  expect(new URL(openURL.mock.calls[1][0]).hostname).toBe('www.google.com');
  expect(hook.value).toMatchObject({ pending: false, error: 'Não foi possível abrir o mapa. Tenta novamente.' });
  openURL.mockResolvedValue(undefined);
  await hook.value.open(event);
  expect(hook.value.error).toBe('');
  hook.unmount();
});

it('não consulta GPS nem abre mapas para eventos antigos sem coordenadas', async () => {
  const { hook, location, openURL } = mount();
  await hook.value.open({ id: 'legacy', location: 'Chaves' });
  expect(location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(openURL).not.toHaveBeenCalled();
  expect(hook.value.error).toContain('coordenadas');
  hook.unmount();
});
