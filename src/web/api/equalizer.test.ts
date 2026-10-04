import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";
import { createPlayerRouter } from "./player.js";
import { defaultEqualizer, EQ_FREQUENCIES } from "../../audio/equalizer.js";

const admin = { role: "admin", bots: "all" };
function setup(user: any = admin) {
  const setEqualizer = vi.fn(value => value);
  const bot = { setEqualizer, getPlayer: () => ({ getEqualizer: defaultEqualizer }) };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/player', createPlayerRouter({ getBot: (id: string) => id === 'b' ? bot : undefined } as any, pino({ level: 'silent' })));
  return { app, setEqualizer };
}
const endpoint = '/api/player/b/equalizer';
describe('equalizer API', () => {
  it('returns band metadata and saved settings', async () => {
    const { app } = setup();
    const res = await request(app).get(endpoint);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frequencies: EQ_FREQUENCIES, equalizer: defaultEqualizer() });
  });
  it('saves a complete validated configuration', async () => {
    const { app, setEqualizer } = setup();
    const value = { ...defaultEqualizer(), enabled: true, preamp: -6 };
    const res = await request(app).post(endpoint).send(value);
    expect(res.status).toBe(200); expect(res.body.equalizer).toEqual(value);
    expect(setEqualizer).toHaveBeenCalledWith(value);
  });
  it.each([{}, { enabled: 'true' }, { gains: [0] }, { gains: Array(10).fill(15) },
    { gains: Array(10).fill(null) }, { preamp: 1 }, { preamp: -25 }])('rejects invalid settings %j', async patch => {
    const { app, setEqualizer } = setup();
    const body = Object.keys(patch).length ? { ...defaultEqualizer(), ...patch } : {};
    expect((await request(app).post(endpoint).send(body)).status).toBe(400);
    expect(setEqualizer).not.toHaveBeenCalled();
  });
  it.each([
    [undefined, 401],
    [{ role: 'member', bots: 'all', capabilities: new Set() }, 403],
    [{ role: 'member', bots: new Set(['other']), capabilities: new Set(['player.control']) }, 403],
    [{ role: 'guest', bots: 'all', guest: { transport: false } }, 403],
    [{ role: 'guest', bots: 'all', guest: { transport: true } }, 200],
    [{ role: 'member', bots: new Set(['b']), capabilities: new Set(['player.control']) }, 200],
  ])('enforces permissions for %j', async (user, status) => {
    const { app, setEqualizer } = setup(user ?? null);
    expect((await request(app).post(endpoint).send(defaultEqualizer())).status).toBe(status);
    expect(setEqualizer).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    if (status === 401) expect((await request(app).get(endpoint)).status).toBe(401);
  });
  it('denies reads for inaccessible bots and handles unknown bots', async () => {
    expect((await request(setup({ role: 'member', bots: new Set() }).app).get(endpoint)).status).toBe(403);
    expect((await request(setup().app).get('/api/player/missing/equalizer')).status).toBe(404);
  });
  it('reports persistence failures rather than claiming a successful save', async () => {
    const { app, setEqualizer } = setup();
    setEqualizer.mockImplementation(() => { throw new Error('disk full'); });
    expect((await request(app).post(endpoint).send(defaultEqualizer())).status).toBe(500);
  });
});
