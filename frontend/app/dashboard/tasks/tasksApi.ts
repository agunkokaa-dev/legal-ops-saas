import { getPublicApiBase } from '@/lib/public-api-base'

const TASKS_API_BASE = `${getPublicApiBase()}/api/v1/tasks`
const TEMPLATES_API_BASE = `${getPublicApiBase()}/api/v1/templates`

async function requestJson(path: string, token: string, init: RequestInit = {}) {
    const res = await fetch(path, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...init.headers,
        },
    })

    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
        throw new Error(payload.detail || `API error ${res.status}`)
    }

    return payload
}

export async function getTasksAPI(token: string) {
    const data = await requestJson(`${TASKS_API_BASE}?include_matter=true`, token, {
        headers: { 'Content-Type': 'application/json' },
    })
    return data.tasks || []
}

export async function getTaskDetailsAPI(token: string, taskId: string) {
    return requestJson(`${TASKS_API_BASE}/${taskId}?include_details=true`, token, {
        headers: { 'Content-Type': 'application/json' },
    })
}

export async function updateTaskAPI(token: string, taskId: string, payload: Record<string, unknown>) {
    return requestJson(`${TASKS_API_BASE}/${taskId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    })
}

export async function deleteTaskAPI(token: string, taskId: string) {
    await requestJson(`${TASKS_API_BASE}/${taskId}`, token, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
    })
}

export async function createSubTaskAPI(token: string, taskId: string, title: string) {
    const data = await requestJson(`${TASKS_API_BASE}/${taskId}/sub-tasks`, token, {
        method: 'POST',
        body: JSON.stringify({ title }),
    })
    return data.sub_task
}

export async function updateSubTaskAPI(token: string, subTaskId: string, payload: Record<string, unknown>) {
    return requestJson(`${TASKS_API_BASE}/sub-tasks/${subTaskId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    })
}

export async function deleteSubTaskAPI(token: string, subTaskId: string) {
    await requestJson(`${TASKS_API_BASE}/sub-tasks/${subTaskId}`, token, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
    })
}

export async function deleteAttachmentAPI(token: string, attachmentId: string) {
    await requestJson(`${TASKS_API_BASE}/attachments/${attachmentId}`, token, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
    })
}

export async function createTaskAPI(token: string, payload: Record<string, unknown>) {
    const data = await requestJson(TASKS_API_BASE, token, {
        method: 'POST',
        body: JSON.stringify(payload),
    })
    return data.task
}

export async function getTemplatesAPI(token: string) {
    const data = await requestJson(TEMPLATES_API_BASE, token, {
        headers: { 'Content-Type': 'application/json' },
    })
    return data.templates || []
}

export async function deleteTemplateAPI(token: string, templateId: string) {
    await requestJson(`${TEMPLATES_API_BASE}/${templateId}`, token, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
    })
}

export async function getMattersAPI(token: string) {
    const data = await requestJson(`${getPublicApiBase()}/api/v1/matters`, token, {
        headers: { 'Content-Type': 'application/json' },
    })
    return data.data || data.matters || []
}

export async function createAttachmentAPI(token: string, taskId: string, payload: Record<string, unknown>) {
    const data = await requestJson(`${TASKS_API_BASE}/${taskId}/attachments`, token, {
        method: 'POST',
        body: JSON.stringify(payload),
    })
    return data.attachment
}
