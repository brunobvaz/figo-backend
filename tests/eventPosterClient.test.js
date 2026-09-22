import { afterEach, expect, it, vi } from 'vitest';
import { mountClient } from './helpers/mountClient.js';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const flush = () => vi.advanceTimersByTimeAsync(0);
afterEach(() => vi.useRealTimers());

function mountPoster({ reducedMotion = false, image = 'https://example.com/cartaz.webp' } = {}) {
  let motionListener;
  const animations = [];
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    interpolate({ outputRange: [from, to] }) {
      const value = this;
      return { get current() { return from + (to - from) * value.value; } };
    }
  }
  const remove = vi.fn();
  const native = {
    StyleSheet: { create: styles => styles }, Image: 'Image', Pressable: 'Pressable', Text: 'Text',
    useWindowDimensions: () => ({ width: 400 }),
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(reducedMotion),
      addEventListener: (_, callback) => { motionListener = callback; return { remove }; }
    },
    Easing: { cubic: 'cubic', inOut: curve => curve },
    Animated: { View: 'AnimatedView', Value,
      timing(value, options) {
        const animation = { ...options, start: vi.fn(() => value.setValue(options.toValue)), stop: vi.fn() };
        animations.push(animation); return animation;
      }
    }
  };
  const hook = mountClient('src/components/common/EventPoster.js', [{ image, title: 'Feira da horta' }], { 'react-native': native });
  return { hook, animations, remove, motion: value => motionListener(value),
    image: () => nodes(hook.value).find(node => node.type === 'Image'),
    button: () => nodes(hook.value).find(node => node.type === 'Pressable'),
    height: () => hook.value.props.style[1].height.current };
}

it('mostra metade do cartaz, expande e recolhe sem mudar a escala da imagem', async () => {
  vi.useFakeTimers();
  const poster = mountPoster(); await flush();
  expect(poster.height()).toBe(250);
  expect(poster.image().props.style[1].height).toBe(500);
  expect(poster.button()).toBeUndefined();
  poster.image().props.onLoad(); await flush();
  expect(poster.button().props.accessibilityLabel).toBe('Expandir cartaz');
  expect(poster.button().props.accessibilityState.expanded).toBe(false);
  poster.button().props.onPress(); await flush();
  expect(poster.height()).toBe(500);
  expect(poster.image().props.style[1].height).toBe(500);
  expect(poster.image().props.resizeMode).toBe('contain');
  expect(poster.button().props.accessibilityLabel).toBe('Recolher cartaz');
  const opening = poster.animations.at(-1);
  expect(opening).toMatchObject({ toValue: 1, duration: 360, useNativeDriver: false });
  poster.button().props.onPress(); await flush();
  expect(opening.stop).toHaveBeenCalledOnce();
  expect(poster.height()).toBe(250);
  poster.hook.value.props.onLayout({ nativeEvent: { layout: { width: 320 } } }); await flush();
  expect(poster.height()).toBe(200);
  poster.button().props.onPress(); await flush();
  expect(poster.height()).toBe(400);
  poster.hook.unmount(); expect(poster.animations.at(-1).stop).toHaveBeenCalledOnce(); expect(poster.remove).toHaveBeenCalledOnce();
});

it('respeita a preferência de reduzir movimento e reage a alterações da preferência', async () => {
  vi.useFakeTimers();
  const poster = mountPoster({ reducedMotion: true }); await flush();
  poster.image().props.onLoad(); await flush();
  poster.button().props.onPress(); await flush();
  expect(poster.height()).toBe(500); expect(poster.animations).toHaveLength(0);
  poster.motion(false); await flush();
  poster.button().props.onPress(); await flush();
  expect(poster.animations.at(-1)).toMatchObject({ toValue: 0, duration: 360 });
  poster.hook.unmount();
});

it('omite o cartaz e o controlo quando não há imagem ou o carregamento falha', async () => {
  vi.useFakeTimers();
  const empty = mountPoster({ image: null }); await flush();
  expect(empty.hook.value).toBeNull(); empty.hook.unmount();
  const poster = mountPoster(); await flush();
  poster.image().props.onError(); await flush();
  expect(poster.hook.value).toBeNull(); poster.hook.unmount();
});
