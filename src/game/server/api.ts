import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const token = z.string().regex(/^[a-f0-9]{32}$/);
const code = z.string().regex(/^[A-Z0-9]{4}$/);

const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("attack"), actorId: z.string().min(1).max(80), targetId: z.string().min(1).max(80) }),
  z.object({
    kind: z.literal("skill"),
    actorId: z.string().min(1).max(80),
    skillId: z.string().min(1).max(80),
    targetId: z.string().min(1).max(80),
  }),
  z.object({ kind: z.literal("end") }),
  z.object({
    kind: z.literal("crisis"),
    actorId: z.string().min(1).max(80),
    choice: z.enum(["purify", "retreat", "continue"]),
  }),
]);

export const getRoster = createServerFn({ method: "POST" })
  .validator(z.object({ token }))
  .handler(async ({ data }) => {
    const { getRoster: run } = await import("./logic.server.ts");
    return run(data.token);
  });

export const spendPoint = createServerFn({ method: "POST" })
  .validator(z.object({ token, instanceId: z.string().min(1).max(80), stat: z.enum(["hp", "atk", "def"]) }))
  .handler(async ({ data }) => {
    const { spendPoint: run } = await import("./logic.server.ts");
    return run(data.token, data.instanceId, data.stat);
  });

export const swapUnit = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token,
      faction: z.enum(["imperial", "chaos"]),
      reserveId: z.string().min(1).max(80),
      fieldId: z.string().min(1).max(80),
    }),
  )
  .handler(async ({ data }) => {
    const { swapUnit: run } = await import("./logic.server.ts");
    return run(data.token, data.faction, data.reserveId, data.fieldId);
  });

export const createRoom = createServerFn({ method: "POST" })
  .validator(z.object({ token }))
  .handler(async ({ data }) => {
    const { createRoom: run } = await import("./logic.server.ts");
    return run(data.token);
  });

export const joinRoom = createServerFn({ method: "POST" })
  .validator(z.object({ token, code }))
  .handler(async ({ data }) => {
    const { joinRoom: run } = await import("./logic.server.ts");
    return run(data.token, data.code);
  });

export const createSkirmish = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token,
      faction: z.enum(["imperial", "chaos"]),
      slots: z.array(z.string().min(1).max(80)).length(5),
    }),
  )
  .handler(async ({ data }) => {
    const { createSkirmish: run } = await import("./logic.server.ts");
    return run(data.token, data.faction, data.slots);
  });

export const getRoom = createServerFn({ method: "POST" })
  .validator(z.object({ token, code }))
  .handler(async ({ data }) => {
    const { getRoom: run } = await import("./logic.server.ts");
    return run(data.token, data.code);
  });

const action = {
  token,
  code,
  version: z.number().int().positive(),
  actionId: z.string().min(8).max(80),
};

export const act = createServerFn({ method: "POST" })
  .validator(z.object({ ...action, command: commandSchema }))
  .handler(async ({ data }) => {
    const { act: run } = await import("./logic.server.ts");
    return run(data.token, data.code, data.version, data.actionId, data.command);
  });

export const botAct = createServerFn({ method: "POST" })
  .validator(z.object(action))
  .handler(async ({ data }) => {
    const { botAct: run } = await import("./logic.server.ts");
    return run(data.token, data.code, data.version, data.actionId);
  });

export const absorbLoot = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...action,
      decisions: z
        .array(z.object({ instanceId: z.string().min(1).max(80), mode: z.enum(["purify", "absorb"]) }))
        .max(10),
    }),
  )
  .handler(async ({ data }) => {
    const { absorb } = await import("./logic.server.ts");
    return absorb(data.token, data.code, data.version, data.actionId, data.decisions);
  });

export const requestRematch = createServerFn({ method: "POST" })
  .validator(z.object(action))
  .handler(async ({ data }) => {
    const { rematch } = await import("./logic.server.ts");
    return rematch(data.token, data.code, data.version, data.actionId);
  });
