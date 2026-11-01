-- rentals, design §4.1 (D-090 amendment): the signed note bytes, for HANDOVER_NOTE_STORE=database.
CREATE TABLE "handover_notes" (
    "name" TEXT NOT NULL,
    "pdf" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_notes_pkey" PRIMARY KEY ("name")
);
