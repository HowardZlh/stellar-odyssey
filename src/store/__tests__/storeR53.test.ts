/**
 * R5-3 真实巡天背景开关单测：默认开启 + setter 往返
 */
import { useSimulationStore } from '@/store';

const initial = {
  showGalaxyCatalog: true,
};

beforeEach(() => {
  useSimulationStore.setState(initial);
});

describe('showGalaxyCatalog（R5-3 真实巡天背景开关）', () => {
  it('默认开启', () => {
    expect(useSimulationStore.getState().showGalaxyCatalog).toBe(true);
  });

  it('setShowGalaxyCatalog 往返切换', () => {
    useSimulationStore.getState().setShowGalaxyCatalog(false);
    expect(useSimulationStore.getState().showGalaxyCatalog).toBe(false);
    useSimulationStore.getState().setShowGalaxyCatalog(true);
    expect(useSimulationStore.getState().showGalaxyCatalog).toBe(true);
  });
});
