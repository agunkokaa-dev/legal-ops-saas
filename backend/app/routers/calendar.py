from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from supabase import Client

from app.dependencies import get_tenant_supabase, verify_clerk_token


router = APIRouter()

EventType = Literal[
    "hearing",
    "client_meeting",
    "board_meeting",
    "internal_review",
    "compliance_review",
    "filing_deadline",
    "signature_deadline",
    "contract_renewal",
    "other",
]

Priority = Literal["high", "normal", "low"]


class CalendarEvent(BaseModel):
    id: str
    title: str
    event_date: date
    event_time: str | None = None
    event_type: str
    source: str
    priority: str = "normal"
    location: str | None = None
    contract_id: str | None = None
    matter_id: str | None = None
    notes: str | None = None


class LegalEventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=240)
    event_type: EventType
    event_date: date
    event_time: str | None = None
    priority: Priority = "normal"
    location: str | None = None
    notes: str | None = None
    matter_id: str | None = None
    contract_id: str | None = None
    is_all_day: bool = False


class LegalEventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    event_type: EventType | None = None
    event_date: date | None = None
    event_time: str | None = None
    priority: Priority | None = None
    location: str | None = None
    notes: str | None = None
    matter_id: str | None = None
    contract_id: str | None = None
    is_all_day: bool | None = None


def _event_dump(event: CalendarEvent) -> dict[str, Any]:
    return event.model_dump(mode="json")


def _parse_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value

    if not isinstance(value, str):
        return None

    cleaned = value.strip()
    if not cleaned or cleaned in {"Not Specified", "N/A", "Unknown"}:
        return None

    try:
        return date.fromisoformat(cleaned[:10])
    except ValueError:
        return None


def _normalize_priority(value: Any, default: str = "normal") -> str:
    normalized = str(value or default).strip().lower()
    if normalized in {"high", "urgent", "critical"}:
        return "high"
    if normalized in {"low"}:
        return "low"
    return "normal"


def _safe_time(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


async def _get_events_for_range(
    supabase: Client,
    tenant_id: str,
    start_date: date,
    end_date: date,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    start_str = start_date.isoformat()
    end_str = end_date.isoformat()
    today = date.today()

    try:
        response = (
            supabase.table("legal_events")
            .select("*")
            .eq("tenant_id", tenant_id)
            .gte("event_date", start_str)
            .lte("event_date", end_str)
            .order("event_date", desc=False)
            .execute()
        )
        for row in response.data or []:
            event_date = _parse_date(row.get("event_date"))
            if not event_date:
                continue

            events.append(
                _event_dump(
                    CalendarEvent(
                        id=f"le_{row['id']}",
                        title=row.get("title") or "Legal Event",
                        event_date=event_date,
                        event_time=_safe_time(row.get("event_time")),
                        event_type=row.get("event_type") or "other",
                        source="legal_event",
                        priority=_normalize_priority(row.get("priority")),
                        location=row.get("location"),
                        contract_id=row.get("contract_id"),
                        matter_id=row.get("matter_id"),
                        notes=row.get("notes"),
                    )
                )
            )
    except Exception as exc:
        print(f"[calendar] legal_events source failed: {exc}")

    try:
        response = (
            supabase.table("contracts")
            .select("id, title, end_date, status, matter_id")
            .eq("tenant_id", tenant_id)
            .gte("end_date", start_str)
            .lte("end_date", end_str)
            .neq("status", "ARCHIVED")
            .neq("status", "TERMINATED")
            .neq("status", "EXPIRED")
            .neq("status", "Archived")
            .neq("status", "Terminated")
            .neq("status", "Expired")
            .execute()
        )
        for row in response.data or []:
            event_date = _parse_date(row.get("end_date"))
            if not event_date:
                continue

            events.append(
                _event_dump(
                    CalendarEvent(
                        id=f"cr_{row['id']}",
                        title=f"Contract Renewal: {row.get('title') or 'Untitled Contract'}",
                        event_date=event_date,
                        event_type="contract_renewal",
                        source="contract",
                        priority="high" if (event_date - today).days <= 30 else "normal",
                        contract_id=row.get("id"),
                        matter_id=row.get("matter_id"),
                    )
                )
            )
    except Exception as exc:
        print(f"[calendar] contracts source failed: {exc}")

    try:
        response = (
            supabase.table("contract_obligations")
            .select("id, description, due_date, status, contract_id")
            .eq("tenant_id", tenant_id)
            .gte("due_date", start_str)
            .lte("due_date", end_str)
            .neq("status", "met")
            .neq("status", "completed")
            .neq("status", "done")
            .execute()
        )
        for row in response.data or []:
            event_date = _parse_date(row.get("due_date"))
            if not event_date:
                continue

            description = row.get("description") or "Obligation Deadline"
            events.append(
                _event_dump(
                    CalendarEvent(
                        id=f"ob_{row['id']}",
                        title=str(description)[:80],
                        event_date=event_date,
                        event_type="filing_deadline",
                        source="obligation",
                        priority="high" if (event_date - today).days <= 7 else "normal",
                        contract_id=row.get("contract_id"),
                    )
                )
            )
    except Exception as exc:
        print(f"[calendar] contract_obligations source failed: {exc}")

    try:
        try:
            response = (
                supabase.table("tasks")
                .select("id, title, due_date, event_time, location, priority, matter_id")
                .eq("tenant_id", tenant_id)
                .gte("due_date", start_str)
                .lte("due_date", end_str)
                .neq("status", "done")
                .neq("status", "completed")
                .neq("status", "archived")
                .neq("status", "ARCHIVED")
                .execute()
            )
        except Exception:
            response = (
                supabase.table("tasks")
                .select("id, title, due_date, priority, matter_id")
                .eq("tenant_id", tenant_id)
                .gte("due_date", start_str)
                .lte("due_date", end_str)
                .neq("status", "done")
                .neq("status", "completed")
                .neq("status", "archived")
                .neq("status", "ARCHIVED")
                .execute()
            )

        for row in response.data or []:
            event_date = _parse_date(row.get("due_date"))
            if not event_date:
                continue

            events.append(
                _event_dump(
                    CalendarEvent(
                        id=f"tk_{row['id']}",
                        title=row.get("title") or "Task Deadline",
                        event_date=event_date,
                        event_time=_safe_time(row.get("event_time")),
                        event_type="internal_review",
                        source="task",
                        priority=_normalize_priority(row.get("priority")),
                        location=row.get("location"),
                        matter_id=row.get("matter_id"),
                    )
                )
            )
    except Exception as exc:
        print(f"[calendar] tasks source failed: {exc}")

    events.sort(key=lambda event: (event["event_date"], event.get("event_time") or ""))
    return events


@router.get("/events")
async def get_calendar_events(
    month: str = Query(..., description="Format: YYYY-MM"),
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]

    try:
        year_text, month_text = month.split("-", 1)
        year = int(year_text)
        month_num = int(month_text)
        if month_num < 1 or month_num > 12:
            raise ValueError
        start_date = date(year, month_num, 1)
        end_date = (
            date(year + 1, 1, 1) - timedelta(days=1)
            if month_num == 12
            else date(year, month_num + 1, 1) - timedelta(days=1)
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid month format. Use YYYY-MM")

    events = await _get_events_for_range(supabase, tenant_id, start_date, end_date)
    return {
        "month": month,
        "events": events,
        "total": len(events),
        "high_priority_count": sum(1 for event in events if event["priority"] == "high"),
    }


@router.get("/events/today")
async def get_today_events(
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]
    today = date.today()
    events = await _get_events_for_range(supabase, tenant_id, today, today)
    return {"date": today.isoformat(), "events": events}


@router.get("/upcoming")
async def get_upcoming_events(
    days: int = Query(7, ge=1, le=90),
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]
    today = date.today()
    events = await _get_events_for_range(supabase, tenant_id, today, today + timedelta(days=days))
    return {"days": days, "events": events[:20]}


@router.get("/renewals")
async def get_upcoming_renewals(
    days: int = Query(90, ge=1, le=365),
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]
    today = date.today()
    end = today + timedelta(days=days)

    try:
        response = (
            supabase.table("contracts")
            .select("id, title, end_date, status, matter_id, counterparty_name")
            .eq("tenant_id", tenant_id)
            .gte("end_date", today.isoformat())
            .lte("end_date", end.isoformat())
            .neq("status", "ARCHIVED")
            .neq("status", "TERMINATED")
            .neq("status", "Archived")
            .neq("status", "Terminated")
            .order("end_date", desc=False)
            .limit(10)
            .execute()
        )
    except Exception as exc:
        print(f"[calendar] renewals source failed: {exc}")
        return {"renewals": [], "total": 0}

    renewals: list[dict[str, Any]] = []
    for row in response.data or []:
        end_date = _parse_date(row.get("end_date"))
        if not end_date:
            continue

        days_left = (end_date - today).days
        renewals.append(
            {
                "id": row.get("id"),
                "title": row.get("title") or "Untitled Contract",
                "counterparty": row.get("counterparty_name"),
                "end_date": end_date.isoformat(),
                "days_left": days_left,
                "urgency": (
                    "critical"
                    if days_left <= 14
                    else "warning"
                    if days_left <= 30
                    else "normal"
                ),
            }
        )

    return {"renewals": renewals, "total": len(renewals)}


@router.post("/events/legal")
async def create_legal_event(
    payload: LegalEventCreate,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]
    data = payload.model_dump(exclude_none=True)
    data["tenant_id"] = tenant_id
    data["event_date"] = payload.event_date.isoformat()
    data["created_by"] = claims.get("sub")

    response = supabase.table("legal_events").insert(data).execute()
    return response.data[0] if response.data else {}


@router.patch("/events/legal/{event_id}")
async def update_legal_event(
    event_id: str,
    payload: LegalEventUpdate,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]
    data = payload.model_dump(exclude_none=True)
    if "event_date" in data and isinstance(data["event_date"], date):
        data["event_date"] = data["event_date"].isoformat()
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    response = (
        supabase.table("legal_events")
        .update(data)
        .eq("id", event_id)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    return response.data[0] if response.data else {}


@router.delete("/events/legal/{event_id}")
async def delete_legal_event(
    event_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]
    (
        supabase.table("legal_events")
        .delete()
        .eq("id", event_id)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    return {"deleted": event_id}
