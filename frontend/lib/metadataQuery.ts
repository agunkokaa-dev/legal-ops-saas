export interface ContractMetadata {
    id: string;
    title: string;
    status?: string | null;
    contract_value?: number | string | null;
    currency?: string | null;
    risk_level?: string | null;
    document_category?: string | null;
    effective_date?: string | null;
    end_date?: string | null;
    counterparty?: string | null;
    counterparty_name?: string | null;
}

export const MAX_METADATA_CONTRACTS = 20;
export const CONTRACTS_METADATA_EVENT = 'contracts-metadata:update';
export const CONTRACTS_METADATA_STORAGE_KEY = 'documents:contractsMetadata';

export function parseContractValue(val: number | string | null | undefined): number {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    // Handle '500000000.0', '500.000.000', '500,000,000', '500000000'
    const cleaned = String(val)
        .replace(/[,\s]/g, '')     // hapus koma dan spasi
        .replace(/\.(?=\d{3})/g, '') // hapus titik ribuan (500.000.000)
        // tapi pertahankan titik desimal (500000000.0)
    return parseFloat(cleaned) || 0;
}

export function formatRupiah(val: number): string {
    if (!val) return 'Rp 0';
    if (val >= 1_000_000_000) return `Rp ${(val / 1_000_000_000).toFixed(1)} miliar`;
    if (val >= 1_000_000) return `Rp ${(val / 1_000_000).toFixed(0)} juta`;
    return `Rp ${val.toLocaleString('id-ID')}`;
}

function parseQueryNumber(rawNumber: string): number {
    const normalized = rawNumber.trim();
    if (normalized.includes(',') && !normalized.includes('.')) {
        return Number.parseFloat(normalized.replace(',', '.')) || 0;
    }

    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(normalized)) {
        return Number.parseFloat(normalized.replace(/[.,]/g, '')) || 0;
    }

    return Number.parseFloat(normalized.replace(',', '.')) || 0;
}

function parseValueThreshold(match: RegExpMatchArray): number {
    const multiplierMap: Record<string, number> = {
        miliar: 1e9,
        milyar: 1e9,
        m: 1e9,
        juta: 1e6,
        jt: 1e6,
        ribu: 1e3,
        rb: 1e3,
    };
    const unit = match[2]?.toLowerCase() || 'juta';
    const multiplier = multiplierMap[unit] || 1e6;
    return parseQueryNumber(match[1]) * multiplier;
}

function metadataLine(contract: ContractMetadata, includeStatus = true): string {
    const value = parseContractValue(contract.contract_value);
    const status = contract.status || 'unknown';
    return `- **${contract.title || 'Untitled'}** — ${value ? formatRupiah(value) : 'nilai tidak tersedia'}${includeStatus ? ` (${status})` : ''}`;
}

export function normalizeContractsMetadata(contracts: ContractMetadata[]): ContractMetadata[] {
    return contracts.slice(0, MAX_METADATA_CONTRACTS).map((contract) => ({
        id: contract.id,
        title: contract.title || 'Untitled',
        status: contract.status || '',
        contract_value: contract.contract_value ?? null,
        currency: contract.currency || 'IDR',
        risk_level: contract.risk_level || null,
        document_category: contract.document_category || null,
        effective_date: contract.effective_date || null,
        end_date: contract.end_date || null,
        counterparty: contract.counterparty || contract.counterparty_name || null,
    }));
}

export function publishContractsMetadata(contracts: ContractMetadata[]): void {
    if (typeof window === 'undefined') return;
    console.log('[MetadataBridge] Publishing:', contracts.length, 'contracts');
    const normalized = normalizeContractsMetadata(contracts);
    window.sessionStorage.setItem(CONTRACTS_METADATA_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(CONTRACTS_METADATA_EVENT, { detail: normalized }));
}

export function readStoredContractsMetadata(): ContractMetadata[] {
    if (typeof window === 'undefined') return [];
    try {
        const stored = window.sessionStorage.getItem(CONTRACTS_METADATA_STORAGE_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? normalizeContractsMetadata(parsed) : [];
    } catch {
        return [];
    }
}

export function isLikelyMetadataQuery(question: string): boolean {
    const q = question.toLowerCase();
    const metadataPatterns = [
        'berapa',
        'total',
        'daftar',
        'apa saja',
        'kontrak mana',
        'status',
        'reviewed',
        'signed',
        'ditandatangani',
        'pending',
        'menunggu',
        'negosiasi',
        'risiko',
        'risk',
        'nilai',
        'senilai',
        'bernilai',
        'value',
        'nominal',
        'di bawah',
        'kurang dari',
        'less than',
        '<',
        'di atas',
        'lebih dari',
        'more than',
        '>',
        'berakhir',
        'expired',
        'expiry',
        'jatuh tempo',
        'habis',
        'kadaluarsa',
        'kedaluwarsa',
        'end date',
        'masa berlaku',
        'segera berakhir',
        'tanggal berakhir',
        'paling dekat',
        'paling cepat berakhir',
        'pertama berakhir',
    ];
    return metadataPatterns.some((pattern) => q.includes(pattern));
}

export function tryAnswerFromMetadata(
    question: string,
    contracts: ContractMetadata[],
): string | null {
    if (!contracts || contracts.length === 0) return null;

    const q = question.toLowerCase();

    const belowMatch = q.match(
        /(?:di bawah|dibawah|kurang dari|less than|<)\s*([\d,.]+)\s*(juta|miliar|milyar|ribu|rb|jt|m)?/
    );
    if (belowMatch) {
        const threshold = parseValueThreshold(belowMatch);
        const matching = contracts.filter((contract) => {
            const val = parseContractValue(contract.contract_value);
            return val > 0 && val < threshold;
        });

        if (matching.length === 0) {
            return `Tidak ada kontrak dengan nilai di bawah ${formatRupiah(threshold)}.`;
        }

        return (
            `${matching.length} kontrak dengan nilai di bawah ${formatRupiah(threshold)}:\n\n` +
            matching.map((contract) => metadataLine(contract)).join('\n')
        );
    }

    const aboveMatch = q.match(
        /(?:di atas|lebih dari|more than|>)\s*([\d,.]+)\s*(juta|miliar|milyar|ribu|rb|jt|m)?/
    );
    if (aboveMatch) {
        const threshold = parseValueThreshold(aboveMatch);
        const matching = contracts.filter((contract) => {
            const val = parseContractValue(contract.contract_value);
            return val > threshold;
        });

        if (matching.length === 0) {
            return `Tidak ada kontrak dengan nilai di atas ${formatRupiah(threshold)}.`;
        }

        return (
            `${matching.length} kontrak dengan nilai di atas ${formatRupiah(threshold)}:\n\n` +
            matching.map((contract) => metadataLine(contract)).join('\n')
        );
    }

    // Exact / approximate value match: "kontrak dengan nilai 500 juta", "senilai 500 juta"
    const exactValueMatch = q.match(
        /(?:senilai|nilai|bernilai|value|nominal)\s*([\d,.]+)\s*(juta|miliar|milyar|ribu|rb|jt|m)?/
    );
    if (exactValueMatch) {
        const targetValue = parseValueThreshold(exactValueMatch);
        const tolerance = targetValue * 0.1; // 10% tolerance

        const matching = contracts.filter((contract) => {
            const val = parseContractValue(contract.contract_value);
            return val > 0 && Math.abs(val - targetValue) <= tolerance;
        });

        if (matching.length === 0) {
            // Fallback: show closest contracts
            const sorted = contracts
                .filter((c) => parseContractValue(c.contract_value) > 0)
                .sort(
                    (a, b) =>
                        Math.abs(parseContractValue(a.contract_value) - targetValue) -
                        Math.abs(parseContractValue(b.contract_value) - targetValue)
                );
            if (sorted.length === 0) {
                return `Tidak ada kontrak dengan nilai tersedia.`;
            }
            return (
                `Tidak ada kontrak dengan nilai tepat ${formatRupiah(targetValue)}.\n\nKontrak terdekat:\n` +
                sorted
                    .slice(0, 3)
                    .map((c) => metadataLine(c))
                    .join('\n')
            );
        }

        return (
            `${matching.length} kontrak dengan nilai sekitar ${formatRupiah(targetValue)}:\n\n` +
            matching.map((c) => metadataLine(c)).join('\n')
        );
    }

    const statusKeywords: Record<string, string[]> = {
        reviewed: ['reviewed', 'sudah direview', 'selesai direview'],
        awaiting_counterparty: ['awaiting', 'menunggu counterparty', 'belum ada counterparty'],
        in_negotiation: ['negosiasi', 'negotiating', 'in negotiation', 'sedang negosiasi'],
        pending: ['pending', 'menunggu', 'belum selesai'],
        signed: ['signed', 'ditandatangani', 'sudah ttd'],
        executed: ['executed', 'aktif dieksekusi'],
        active: ['active', 'aktif'],
        in_review: ['in review', 'sedang direview'],
    };

    for (const [statusKey, keywords] of Object.entries(statusKeywords)) {
        if (keywords.some((keyword) => q.includes(keyword))) {
            const compactStatus = statusKey.replace(/_/g, '');
            const matching = contracts.filter((contract) => {
                const status = contract.status?.toLowerCase() || '';
                return status.includes(statusKey.toLowerCase()) ||
                    status.replace(/[_\s-]/g, '').includes(compactStatus);
            });

            if (matching.length === 0) {
                return `Tidak ada kontrak dengan status ${statusKey.replace(/_/g, ' ')}.`;
            }

            return (
                `${matching.length} kontrak dengan status **${statusKey.replace(/_/g, ' ')}**:\n\n` +
                matching.map((contract) => metadataLine(contract, false)).join('\n')
            );
        }
    }

    const riskKeywords: Record<string, string[]> = {
        high: ['risiko tinggi', 'high risk', 'berisiko tinggi'],
        medium: ['risiko sedang', 'medium risk'],
        low: ['risiko rendah', 'low risk', 'aman'],
        critical: ['kritis', 'critical', 'sangat berisiko'],
    };

    for (const [riskKey, keywords] of Object.entries(riskKeywords)) {
        if (keywords.some((keyword) => q.includes(keyword))) {
            const allowedRisks = riskKey === 'high' ? ['high', 'critical'] : [riskKey];
            const matching = contracts.filter((contract) =>
                allowedRisks.includes(contract.risk_level?.toLowerCase() || '')
            );

            if (matching.length === 0) {
                return `Tidak ada kontrak dengan risiko ${riskKey}.`;
            }

            return (
                `${matching.length} kontrak dengan risiko **${riskKey}**:\n\n` +
                matching.map((contract) => metadataLine(contract)).join('\n')
            );
        }
    }

    if (q.includes('berapa kontrak') || q.includes('total kontrak') || q.includes('semua kontrak') || q.includes('daftar kontrak')) {
        const total = contracts.length;
        return (
            `Total **${total} kontrak** tersimpan:\n\n` +
            contracts
                .slice(0, 10)
                .map((contract) => metadataLine(contract))
                .join('\n') +
            (total > 10 ? `\n\n...dan ${total - 10} kontrak lainnya.` : '')
        );
    }

    // ── List nilai semua kontrak ──────────────────────────────────────────
    // "berapa nilai kontrak", "nilai semua kontrak", "daftar nilai kontrak"
    // "berapa saja nilai kontrak", "tampilkan nilai kontrak"
    const valueListPattern = [
        'nilai kontrak', 'nilai semua', 'daftar nilai',
        'berapa nilai', 'semua nilai', 'kontrak bernilai',
        'harga kontrak', 'nilai masing-masing',
    ];
    if (valueListPattern.some(p => q.includes(p))) {
        const withValue = contracts.filter(c => parseContractValue(c.contract_value) > 0);
        
        if (withValue.length === 0) {
            return 'Belum ada informasi nilai kontrak yang tersedia.';
        }
        
        // Sort by value descending
        const sorted = [...withValue].sort(
            (a, b) => parseContractValue(b.contract_value) - parseContractValue(a.contract_value)
        );
        
        const totalValue = sorted.reduce(
            (sum, c) => sum + parseContractValue(c.contract_value), 0
        );
        
        return (
            `Nilai ${sorted.length} kontrak yang tersimpan:\n\n` +
            sorted.map((c, i) =>
                `${i + 1}. **${c.title}**\n   ${formatRupiah(parseContractValue(c.contract_value))} · ${c.status || 'N/A'}`
            ).join('\n\n') +
            `\n\n**Total nilai:** ${formatRupiah(totalValue)}`
        );
    }

    // ── Date / expiry queries ─────────────────────────────────────────────
    const dateKeywords = [
        'berakhir',
        'expired',
        'expiry',
        'jatuh tempo',
        'habis',
        'akan berakhir',
        'segera berakhir',
        'kadaluarsa',
        'kedaluwarsa',
        'selesai',
        'end date',
        'tanggal berakhir',
        'masa berlaku',
    ];

    if (dateKeywords.some((keyword) => q.includes(keyword))) {
        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

        const withParsedDate = contracts
            .filter(
                (contract) =>
                    contract.end_date &&
                    contract.end_date !== 'null' &&
                    contract.end_date !== 'Not Specified' &&
                    contract.end_date !== 'not specified' &&
                    contract.end_date !== 'N/A'
            )
            .map((contract) => ({
                ...contract,
                parsedEnd: new Date(contract.end_date as string),
            }))
            .filter((contract) => !Number.isNaN(contract.parsedEnd.getTime()))
            .sort((a, b) => a.parsedEnd.getTime() - b.parsedEnd.getTime());

        if (withParsedDate.length === 0) {
            return 'Tidak ada informasi tanggal berakhir yang tersedia untuk kontrak-kontrak ini.';
        }

        const expired = withParsedDate.filter((contract) => contract.parsedEnd < now);
        const expiringSoon = withParsedDate.filter(
            (contract) => contract.parsedEnd >= now && contract.parsedEnd <= thirtyDaysFromNow
        );
        const expiringIn90 = withParsedDate.filter(
            (contract) => contract.parsedEnd >= now && contract.parsedEnd <= ninetyDaysFromNow
        );
        const expiringThisMonth = withParsedDate.filter(
            (contract) =>
                contract.parsedEnd.getFullYear() === now.getFullYear() &&
                contract.parsedEnd.getMonth() === now.getMonth()
        );
        const expiringThisYear = withParsedDate.filter(
            (contract) => contract.parsedEnd.getFullYear() === now.getFullYear()
        );

        const formatDate = (date: Date) =>
            date.toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            });

        const daysUntil = (date: Date) => {
            const diff = date.getTime() - now.getTime();
            return Math.ceil(diff / (1000 * 60 * 60 * 24));
        };

        const dateLine = (contract: (typeof withParsedDate)[number]) => {
            const days = daysUntil(contract.parsedEnd);
            const timing = days < 0
                ? `sudah berakhir ${Math.abs(days)} hari lalu`
                : `${days} hari lagi`;
            return `- **${contract.title}** — ${formatDate(contract.parsedEnd)} (${timing})`;
        };

        if (
            q.includes('paling dekat') ||
            q.includes('paling cepat berakhir') ||
            q.includes('pertama berakhir')
        ) {
            const upcoming = withParsedDate.filter((contract) => contract.parsedEnd >= now);
            const soonest = upcoming[0] || [...expired].sort(
                (a, b) => b.parsedEnd.getTime() - a.parsedEnd.getTime()
            )[0];

            if (!soonest) return 'Tidak ada data tanggal berakhir.';

            const days = daysUntil(soonest.parsedEnd);
            return (
                `Kontrak yang paling dekat berakhir:\n\n` +
                `- **${soonest.title}**\n` +
                `  Berakhir: ${formatDate(soonest.parsedEnd)}\n` +
                `  Status: ${days < 0 ? `Sudah berakhir ${Math.abs(days)} hari lalu` : `${days} hari lagi`}`
            );
        }

        if (q.includes('bulan ini')) {
            if (expiringThisMonth.length === 0) {
                return 'Tidak ada kontrak yang berakhir bulan ini.';
            }
            return (
                `${expiringThisMonth.length} kontrak yang berakhir bulan ini:\n\n` +
                expiringThisMonth.map(dateLine).join('\n')
            );
        }

        if (q.includes('tahun ini')) {
            if (expiringThisYear.length === 0) {
                return 'Tidak ada kontrak yang berakhir tahun ini.';
            }
            return (
                `${expiringThisYear.length} kontrak yang berakhir tahun ini:\n\n` +
                expiringThisYear.map(dateLine).join('\n')
            );
        }

        if (q.includes('sudah') || q.includes('expired') || q.includes('kadaluarsa') || q.includes('kedaluwarsa')) {
            if (expired.length === 0) {
                return 'Tidak ada kontrak yang sudah berakhir.';
            }
            return (
                `${expired.length} kontrak yang sudah berakhir:\n\n` +
                expired.map(dateLine).join('\n')
            );
        }

        if (q.includes('segera') || q.includes('akan berakhir') || q.includes('dekat')) {
            if (expiringSoon.length === 0) {
                return expiringIn90.length > 0
                    ? (
                        `Tidak ada kontrak yang berakhir dalam 30 hari ke depan.\n\n` +
                        `Namun ${expiringIn90.length} kontrak berakhir dalam 90 hari:\n\n` +
                        expiringIn90.map(dateLine).join('\n')
                    )
                    : 'Tidak ada kontrak yang akan berakhir dalam waktu dekat.';
            }
            return (
                `${expiringSoon.length} kontrak yang akan berakhir dalam 30 hari:\n\n` +
                expiringSoon.map(dateLine).join('\n')
            );
        }

        return (
            `Tanggal berakhir kontrak:\n\n` +
            withParsedDate.map((contract) => {
                const days = daysUntil(contract.parsedEnd);
                const status = days < 0
                    ? `Merah - sudah berakhir ${Math.abs(days)} hari lalu`
                    : days <= 30
                        ? `Merah - ${days} hari lagi`
                        : days <= 90
                            ? `Kuning - ${days} hari lagi`
                            : `Hijau - ${days} hari lagi`;
                return `- **${contract.title}** — ${formatDate(contract.parsedEnd)} (${status})`;
            }).join('\n')
        );
    }

    // ── Nilai kontrak tertentu by name ────────────────────────────────────
    // "berapa nilai SOW kasir", "nilai kontrak MSA"
    const contractNames = contracts.map(c => c.title.toLowerCase().replace(/[._-]/g, ' '));
    for (let i = 0; i < contracts.length; i++) {
        const nameTokens = contractNames[i].split(' ').filter(t => t.length > 3);
        if (nameTokens.some(token => q.includes(token))) {
            const c = contracts[i];
            const val = parseContractValue(c.contract_value);
            if (val > 0) {
                return `**${c.title}**\nNilai: ${formatRupiah(val)}\nStatus: ${c.status || 'N/A'}`;
            }
        }
    }

    return null;
}
