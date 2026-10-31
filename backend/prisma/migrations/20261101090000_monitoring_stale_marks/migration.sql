-- The staleness sweep (monitoring task 2.4) stores what it last reported stale, so it emits each
-- stale and recovered transition once and a restart repeats none. Additive only.
-- CreateEnum
CREATE TYPE "StaleSubject" AS ENUM ('DEVICE', 'FIELD_STATION');

-- CreateTable
CREATE TABLE "stale_marks" (
    "subjectType" "StaleSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "organizationId" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "markedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stale_marks_pkey" PRIMARY KEY ("subjectType","subjectId")
);

