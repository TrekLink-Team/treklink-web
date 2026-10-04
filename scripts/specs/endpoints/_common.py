"""Shared helpers and sample identifiers for the endpoint catalogs."""

ORG_ID = "5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f"
OTHER_ORG_ID = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b"
USER_ID = "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f"
MEMBER_ID = "6c5b4a39-2817-4f06-9e5d-4c3b2a190807"
DEVICE_ID = "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10"
VARIANT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
CONTRACT_ID = "c0ffee00-1234-4abc-9def-001122334455"
INVOICE_ID = "1e2d3c4b-5a69-4788-9a0b-c1d2e3f4a5b6"
INCIDENT_ID = "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d"
STATION_ID = "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b"
NOW = "2026-10-20T03:15:00.000Z"


def ep(method, url, title, permission, overview, traces, **kw):
    d = dict(method=method, url=url, title=title, permission=permission, overview=overview, traces=traces)
    d.update(kw)
    return d


def paged(item, total=1):
    return {"items": [item], "pageNumber": 1, "pageSize": 20, "totalCount": total, "totalPages": 1}


PAGE_QUERY = [["pageNumber", "1-based page", "int", "no", "`1`"],
              ["pageSize", "Items per page, at most MAX_PAGE_SIZE", "int", "no", "`20`"]]


def state_409(entity, msg_state="{state}"):
    return (409, "INVALID_STATE_TRANSITION", f"The {entity} is not in a state that allows this",
            f"This cannot be done while it is {msg_state}.")


STALE = (409, "STALE_VERSION", "Another user changed the record first (expectedVersion differs)",
         "This was changed by someone else. Reload and try again.")


def path(*rows):
    return [list(r) for r in rows]


ID_PATH = ["id", "Record id", "uuid", f"`{CONTRACT_ID}`"]
ORG_PATH = ["id", "Organization id; members may use only their own", "uuid", f"`{ORG_ID}`"]
