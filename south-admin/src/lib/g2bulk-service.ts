/**
 * G2Bulk Game Service - محفظة الجنوب
 * Integrates G2Bulk API with the wallet service
 * Full flow: select game → select country → select denomination → 
 *            enter player ID → CheckPlayer → deduct balance → place order
 */

import { supabase, supabaseService } from './supabase';
import { G2BULK_API_KEY, G2BULK_BASE_URL } from './api-providers';
import { debitWallet, creditWallet, Currency, toMinor, formatMoney } from './wallet-service';

const G2BULK_API_URL = 'https://api.g2bulk.com/v1';

export interface G2BulkGame {
    id: number;
    code: string;
    name: string;
    image_url: string;
    local_image?: string;
}

export interface G2BulkCatalogue {
    id: number;
    name: string;
    amount: number; // USD price
}

export interface G2BulkGameFields {
    fields: string[];
    notes: string;
}

export interface G2BulkGameServers {
    [region: string]: string;
}

export interface PlayerValidationResult {
    valid: boolean;
    name?: string;
    openid?: string;
}

export interface GameOrderResult {
    success: boolean;
    orderId?: number;
    status?: string;
    message?: string;
    price?: number;
    error?: string;
}

/**
 * Call G2Bulk API directly (the API key is safe for client-side use
 * since G2Bulk uses wallet-based auth, not secret auth)
 */
async function g2bulkRequest(path: string, options: RequestInit = {}): Promise<any> {
    const url = path.startsWith('http') ? path : `${G2BULK_API_URL}${path}`;
    const headers: Record<string, string> = {
        'X-API-Key': G2BULK_API_KEY,
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
    };

    const response = await fetch(url, { ...options, headers });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || data.error || `G2Bulk API error: ${response.status}`);
    }

    return data;
}

/**
 * Get all available games
 */
export async function getGames(): Promise<G2BulkGame[]> {
    try {
        // First try to get from Supabase cache
        const { data: cached } = await supabase
            .from('api_games')
            .select('*')
            .eq('provider_id', 'g2bulk')
            .eq('enabled', true)
            .order('name');

        if (cached && cached.length > 0) {
            return cached.map(g => ({
                id: g.id,
                code: g.code,
                name: g.name,
                image_url: g.image_url || '',
                local_image: g.local_image || g.image_url || '',
            }));
        }

        // Fallback: fetch from G2Bulk API
        const data = await g2bulkRequest('/games');
        return (data.games || []).map((g: any) => ({
            id: g.id,
            code: g.code,
            name: g.name,
            image_url: g.image_url ? `https://g2bulk.com${g.image_url}` : '',
        }));
    } catch (err) {
        console.error('[g2bulk-service] getGames error:', err);
        // Return empty array instead of throwing
        return [];
    }
}

/**
 * Get required fields for a game
 */
export async function getGameFields(gameCode: string): Promise<G2BulkGameFields> {
    try {
        const data = await g2bulkRequest('/games/fields', {
            method: 'POST',
            body: JSON.stringify({ game: gameCode }),
        });
        return {
            fields: data.info?.fields || ['userid'],
            notes: data.info?.notes || '',
        };
    } catch (err) {
        console.error('[g2bulk-service] getGameFields error:', err);
        return { fields: ['userid'], notes: '' };
    }
}

/**
 * Get game servers (countries/regions)
 */
export async function getGameServers(gameCode: string): Promise<G2BulkGameServers> {
    try {
        const data = await g2bulkRequest('/games/servers', {
            method: 'POST',
            body: JSON.stringify({ game: gameCode }),
        });
        return data.servers || {};
    } catch (err) {
        console.error('[g2bulk-service] getGameServers error:', err);
        return {};
    }
}

/**
 * Get catalogue (denominations) for a game
 */
export async function getGameCatalogue(gameCode: string): Promise<G2BulkCatalogue[]> {
    try {
        const data = await g2bulkRequest(`/games/${gameCode}/catalogue`);
        return (data.catalogues || []).map((c: any) => ({
            id: c.id,
            name: c.name,
            amount: c.amount,
        }));
    } catch (err) {
        console.error('[g2bulk-service] getGameCatalogue error:', err);
        return [];
    }
}

/**
 * Validate a player ID (CheckPlayer)
 */
export async function checkPlayerId(
    game: string,
    userId: string,
    serverId?: string,
    charname?: string
): Promise<PlayerValidationResult> {
    try {
        const body: any = { game, user_id: userId };
        if (serverId) body.server_id = serverId;
        if (charname) body.charname = charname;

        const data = await g2bulkRequest('/games/checkPlayerId', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        return {
            valid: data.valid === 'valid',
            name: data.name,
            openid: data.openid,
        };
    } catch (err) {
        console.error('[g2bulk-service] checkPlayerId error:', err);
        return { valid: false };
    }
}

/**
 * Place a game order with wallet deduction
 */
export async function placeGameOrder(params: {
    userId: string;
    gameCode: string;
    gameName: string;
    catalogueName: string;
    playerId: string;
    serverId?: string;
    charname?: string;
    priceUSD: number;
    remark?: string;
}): Promise<GameOrderResult> {
    try {
        const { userId, gameCode, gameName, catalogueName, playerId, serverId, charname, priceUSD, remark } = params;

        // Convert USD price to YER (base currency) for deduction
        // USD to YER rate is approximately 101.01
        const priceYER = Math.round(priceUSD * 101.01);
        const amountMinor = priceYER; // YER has 0 decimals

        // Check if user has sufficient balance
        const { data: wallet } = await supabase
            .from('wallets')
            .select('balance_minor')
            .eq('user_id', userId)
            .eq('currency', 'YER')
            .maybeSingle();

        if (!wallet || wallet.balance_minor < amountMinor) {
            return {
                success: false,
                error: `رصيد غير كافي. المطلوب: ${formatMoney(amountMinor, 'YER')}`,
            };
        }

        // Deduct from wallet
        const debitResult = await debitWallet(userId, 'YER', amountMinor, 'purchase', {
            reference: `game-${gameCode}-${Date.now()}`,
            meta: {
                game: gameCode,
                game_name: gameName,
                catalogue: catalogueName,
                player_id: playerId,
                price_usd: priceUSD,
            },
        });

        if (!debitResult.success) {
            return { success: false, error: debitResult.error || 'فشل خصم الرصيد' };
        }

        // Place order with G2Bulk
        const orderBody: any = {
            catalogue_name: catalogueName,
            player_id: playerId,
        };
        if (serverId) orderBody.server_id = serverId;
        if (charname) orderBody.charname = charname;
        if (remark) orderBody.remark = remark;

        const data = await g2bulkRequest(`/games/${gameCode}/order`, {
            method: 'POST',
            body: JSON.stringify(orderBody),
        });

        if (data.success) {
            // Record the order in transactions table
            await supabase.from('transactions').insert({
                user_id: userId,
                type: 'purchase',
                status: data.order?.status || 'pending',
                amount: priceUSD,
                currency: 'USD',
                description: `${gameName} - ${catalogueName}`,
                reference: `game-order-${data.order?.order_id || Date.now()}`,
                meta: {
                    game_code: gameCode,
                    game_name: gameName,
                    catalogue: catalogueName,
                    player_id: playerId,
                    server_id: serverId,
                    g2bulk_order_id: data.order?.order_id,
                    price_yer: priceYER,
                },
            });

            return {
                success: true,
                orderId: data.order?.order_id,
                status: data.order?.status,
                message: data.message || 'تم إنشاء الطلب بنجاح',
                price: data.order?.price,
            };
        } else {
            // Refund the wallet if order failed
            await creditWallet(userId, 'YER', amountMinor, 'refund', {
                reference: `refund-game-${gameCode}-${Date.now()}`,
                meta: { reason: 'G2Bulk order failed', original_debit: debitResult.entry?.id },
            });

            return {
                success: false,
                error: data.message || 'فشل إنشاء الطلب',
            };
        }
    } catch (err: any) {
        console.error('[g2bulk-service] placeGameOrder error:', err);
        return { success: false, error: err.message || 'حدث خطأ غير متوقع' };
    }
}

/**
 * Check order status
 */
export async function checkOrderStatus(orderId: number): Promise<any> {
    try {
        const data = await g2bulkRequest('/games/order/status', {
            method: 'POST',
            body: JSON.stringify({ order_id: orderId }),
        });
        return data;
    } catch (err) {
        console.error('[g2bulk-service] checkOrderStatus error:', err);
        return null;
    }
}

/**
 * Get G2Bulk account balance
 */
export async function getG2BulkBalance(): Promise<number | null> {
    try {
        const data = await g2bulkRequest('/getMe');
        return data.balance || 0;
    } catch (err) {
        console.error('[g2bulk-service] getG2BulkBalance error:', err);
        return null;
    }
}
