import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";
import { createPlayerRouter } from "./player.js";
import { defaultSurround } from "../../audio/surround.js";

const admin = { role: "admin", bots: "all" };
function setup(user: any = admin) {
  const setSurround = vi.fn(value => value);
  const bot = { setSurround, getPlayer: () => ({ getSurround: defaultSurround }) };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/player', createPlayerRouter({ getBot: (id: string) => id === 'b' ? bot : undefined } as any, pino({ level: 'silent' })));
  return { app, setSurround };
}
const endpoint = '/api/player/b/surround';
describe('surround API', () => {
  it('returns band metadata and saved settings', async () => {
    const { app } = setup();
    const res = await request(app).get(endpoint);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ surround: defaultSurround() });
  });
  it('saves a complete validated configuration', async () => {
    const { app, setSurround } = setup();
    const value = { ...defaultSurround(), enabled: true, strength: 90, room: 70 };
    const res = await request(app).post(endpoint).send(value);
    expect(res.status).toBe(200); expect(res.body.surround).toEqual(value);
    expect(setSurround).toHaveBeenCalledWith(value);
  });
  it.each([{}, { enabled: 'true' }, { strength: -1 }, { strength: 101 }, { room: null }, { room: 101 }])('rejects invalid settings %j', async patch => {
    const { app, setSurround } = setup();
    const body = Object.keys(patch).length ? { ...defaultSurround(), ...patch } : {};
    expect((await request(app).post(endpoint).send(body)).status).toBe(400);
    expect(setSurround).not.toHaveBeenCalled();
  });
  it.each([
    [undefined, 401],
    [{ role: 'member', bots: 'all', capabilities: new Set() }, 403],
    [{ role: 'member', bots: new Set(['other']), capabilities: new Set(['player.control']) }, 403],
    [{ role: 'guest', bots: 'all', guest: { transport: false } }, 403],
    [{ role: 'guest', bots: 'all', guest: { transport: true } }, 200],
    [{ role: 'member', bots: new Set(['b']), capabilities: new Set(['player.control']) }, 200],
  ])('enforces permissions for %j', async (user, status) => {
    const { app, setSurround } = setup(user ?? null);
    expect((await request(app).post(endpoint).send(defaultSurround())).status).toBe(status);
    expect(setSurround).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    if (status === 401) expect((await request(app).get(endpoint)).status).toBe(401);
  });
  it('denies reads for inaccessible bots and handles unknown bots', async () => {
    expect((await request(setup({ role: 'member', bots: new Set() }).app).get(endpoint)).status).toBe(403);
    expect((await request(setup().app).get('/api/player/missing/surround')).status).toBe(404);
  });
  it('reports persistence failures rather than claiming a successful save', async () => {
    const { app, setSurround } = setup();
    setSurround.mockImplementation(() => { throw new Error('disk full'); });
    expect((await request(app).post(endpoint).send(defaultSurround())).status).toBe(500);
  });
});
