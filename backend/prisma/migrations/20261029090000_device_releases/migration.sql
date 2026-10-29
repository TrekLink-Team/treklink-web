-- monitoring, task 2.1: the latest check-in of a device from an organization, kept apart from the stream
-- because a late upload is accepted for 168 hours and the stream is pruned after 72.

-- CreateTable
CREATE TABLE "device_releases" (
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_releases_pkey" PRIMARY KEY ("organizationId","deviceId")
);
