#!/usr/bin/env node
import { providerStatus } from "../server/travel/orchestrator.mjs";
import {
  amadeusConfigured,
} from "../server/travel/providers/amadeus.mjs";
import { tripadvisorConfigured } from "../server/travel/providers/tripadvisor.mjs";
import { viatorConfigured } from "../server/travel/providers/viator.mjs";
import { opentableConfigured } from "../server/travel/providers/opentable.mjs";

const status = {
  ok: true,
  providers: providerStatus(),
  configured: {
    amadeus: amadeusConfigured(),
    tripadvisor: tripadvisorConfigured(),
    viator: viatorConfigured(),
    opentable: opentableConfigured(),
  },
  booking_enabled: process.env.TRAVEL_BOOKING_ENABLED === "1",
};

console.log(JSON.stringify(status, null, 2));
