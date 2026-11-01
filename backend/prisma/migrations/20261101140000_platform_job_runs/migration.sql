-- platform, design §4.6 (D-090 rule 1): the last request-driven tick run of each scheduled job.
CREATE TABLE "job_runs" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("name")
);
