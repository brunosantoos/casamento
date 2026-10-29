import { aiRouter } from "./routers/ai.js";
import { auditRouter, privacyRouter, settingsRouter } from "./routers/admin.js";
import { calendarRouter } from "./routers/calendar.js";
import { ceremonyRouter } from "./routers/ceremony.js";
import { dashboardRouter } from "./routers/dashboard.js";
import { filesRouter } from "./routers/files.js";
import { financeRouter } from "./routers/finance.js";
import { guestsRouter } from "./routers/guests.js";
import { membersRouter } from "./routers/members.js";
import { planningRouter } from "./routers/planning.js";
import { portalRouter } from "./routers/portal.js";
import { reportsRouter } from "./routers/reports.js";
import { vendorsRouter } from "./routers/vendors.js";
import { weddingRouter } from "./routers/wedding.js";
import { whatsappRouter } from "./routers/whatsapp.js";
import { giftsRouter } from "./routers/gifts.js";
import { guestPhotosRouter } from "./routers/guestPhotos.js";
import { notificationsRouter } from "./routers/notifications.js";
import { portalGiftsRouter, portalPhotosRouter } from "./routers/portalExtras.js";
import { seatingRouter } from "./routers/seating.js";
import { router } from "./trpc.js";

export const appRouter = router({
  wedding: weddingRouter,
  members: membersRouter,
  dashboard: dashboardRouter,
  finance: financeRouter,
  vendors: vendorsRouter,
  planning: planningRouter,
  calendar: calendarRouter,
  ceremony: ceremonyRouter,
  guests: guestsRouter,
  portal: portalRouter,
  whatsapp: whatsappRouter,
  files: filesRouter,
  ai: aiRouter,
  reports: reportsRouter,
  settings: settingsRouter,
  audit: auditRouter,
  privacy: privacyRouter,
  seating: seatingRouter,
  gifts: giftsRouter,
  guestPhotos: guestPhotosRouter,
  notifications: notificationsRouter,
  portalGifts: portalGiftsRouter,
  portalPhotos: portalPhotosRouter,
});

export type AppRouter = typeof appRouter;
