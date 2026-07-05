/**
 * Admin Service - محفظة الجنوب
 * Full admin management using Tappy infrastructure
 */

import { supabase, supabaseService } from './supabase';

export interface AdminStats {
    totalUsers: number;
    totalTransactions: number;
    totalVolumeYER: number;
    totalVolumeSAR: number;
    totalVolumeUSD: number;
    pendingDeposits: number;
    pendingWithdrawals: number;
    activeOrders: number;
    supportTickets: number;
    g2bulkBalance: number;
}

export interface UserWithWallets {
    id: string;
    email: string;
    phone: string;
    first_name: string;
    second_name: string;
    third_name: string;
    family_name: string;
    role: string;
    kyc_status: string;
    is_active: boolean;
    is_blocked: boolean;
    created_at: string;
    wallets: Array<{
        currency: string;
        balance_minor: number;
        status: string;
    }>;
}

/**
 * Get comprehensive admin dashboard stats
 */
export async function getAdminStats(): Promise<AdminStats> {
    try {
        const [users, txs, deposits, withdraws, orders, tickets, walletsYER, walletsSAR, walletsUSD] = await Promise.all([
            supabase.from('users').select('id', { count: 'exact', head: true }),
            supabase.from('transactions').select('id', { count: 'exact', head: true }),
            supabase.from('deposit_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('withdraw_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['pending', 'processing']),
            supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
            supabase.from('wallets').select('balance_minor').eq('currency', 'YER'),
            supabase.from('wallets').select('balance_minor').eq('currency', 'SAR'),
            supabase.from('wallets').select('balance_minor').eq('currency', 'USD'),
        ]);

        const totalYER = (walletsYER.data || []).reduce((s, w) => s + (w.balance_minor || 0), 0);
        const totalSAR = (walletsSAR.data || []).reduce((s, w) => s + (w.balance_minor || 0), 0);
        const totalUSD = (walletsUSD.data || []).reduce((s, w) => s + (w.balance_minor || 0), 0);

        return {
            totalUsers: users.count || 0,
            totalTransactions: txs.count || 0,
            totalVolumeYER: totalYER,
            totalVolumeSAR: totalSAR,
            totalVolumeUSD: totalUSD,
            pendingDeposits: deposits.count || 0,
            pendingWithdrawals: withdraws.count || 0,
            activeOrders: orders.count || 0,
            supportTickets: tickets.count || 0,
            g2bulkBalance: 0, // Will be fetched separately
        };
    } catch (err) {
        console.error('[admin-service] getAdminStats error:', err);
        return {
            totalUsers: 0,
            totalTransactions: 0,
            totalVolumeYER: 0,
            totalVolumeSAR: 0,
            totalVolumeUSD: 0,
            pendingDeposits: 0,
            pendingWithdrawals: 0,
            activeOrders: 0,
            supportTickets: 0,
            g2bulkBalance: 0,
        };
    }
}

/**
 * Get all users with their wallets
 */
export async function getUsersWithWallets(limit: number = 50, offset: number = 0): Promise<UserWithWallets[]> {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;
        if (!users || users.length === 0) return [];

        const userIds = users.map(u => u.id);
        const { data: wallets } = await supabase
            .from('wallets')
            .select('user_id, currency, balance_minor, status')
            .in('user_id', userIds);

        const walletMap: Record<string, any[]> = {};
        (wallets || []).forEach(w => {
            if (!walletMap[w.user_id]) walletMap[w.user_id] = [];
            walletMap[w.user_id].push({
                currency: w.currency,
                balance_minor: w.balance_minor,
                status: w.status,
            });
        });

        return users.map(u => ({
            ...u,
            wallets: walletMap[u.id] || [],
        })) as UserWithWallets[];
    } catch (err) {
        console.error('[admin-service] getUsersWithWallets error:', err);
        return [];
    }
}

/**
 * Update user role
 */
export async function updateUserRole(userId: string, role: 'user' | 'admin' | 'owner'): Promise<boolean> {
    try {
        const { error } = await supabase
            .from('users')
            .update({ role, updated_at: new Date().toISOString() })
            .eq('id', userId);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[admin-service] updateUserRole error:', err);
        return false;
    }
}

/**
 * Block/unblock user
 */
export async function setUserBlocked(userId: string, blocked: boolean): Promise<boolean> {
    try {
        const { error } = await supabase
            .from('users')
            .update({ is_blocked: blocked, updated_at: new Date().toISOString() })
            .eq('id', userId);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[admin-service] setUserBlocked error:', err);
        return false;
    }
}

/**
 * Approve deposit request
 */
export async function approveDeposit(requestId: string, userId: string, amount: number, currency: string): Promise<boolean> {
    try {
        // Update deposit request status
        const { error: updateErr } = await supabase
            .from('deposit_requests')
            .update({ status: 'completed', processed_at: new Date().toISOString() })
            .eq('id', requestId);

        if (updateErr) throw updateErr;

        // Credit wallet
        const { supabaseAdmin } = await import('./supabase');
        // Use the wallet service to credit
        const decimals = currency === 'YER' ? 0 : 2;
        const amountMinor = Math.round(amount * Math.pow(10, decimals));

        const { data: wallet } = await supabaseAdmin
            .from('wallets')
            .select('id, balance_minor')
            .eq('user_id', userId)
            .eq('currency', currency)
            .maybeSingle();

        if (wallet) {
            const newBalance = wallet.balance_minor + amountMinor;
            await supabaseAdmin.from('wallets').update({ balance_minor: newBalance }).eq('id', wallet.id);
            await supabaseAdmin.from('ledger_entries').insert({
                wallet_id: wallet.id,
                user_id: userId,
                direction: 'credit',
                reason: 'funding',
                amount_minor: amountMinor,
                balance_after_minor: newBalance,
                reference: `deposit-${requestId}`,
            });
        }

        return true;
    } catch (err) {
        console.error('[admin-service] approveDeposit error:', err);
        return false;
    }
}

/**
 * Get all commission rules
 */
export async function getCommissionRules(): Promise<any[]> {
    try {
        const { data, error } = await supabase
            .from('commission_rules')
            .select('*')
            .order('priority', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[admin-service] getCommissionRules error:', err);
        return [];
    }
}

/**
 * Update commission rule
 */
export async function updateCommissionRule(ruleId: string, updates: any): Promise<boolean> {
    try {
        const { error } = await supabase
            .from('commission_rules')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', ruleId);

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[admin-service] updateCommissionRule error:', err);
        return false;
    }
}

/**
 * Get all payments
 */
export async function getPayments(limit: number = 50): Promise<any[]> {
    try {
        const { data, error } = await supabase
            .from('payments')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[admin-service] getPayments error:', err);
        return [];
    }
}

/**
 * Get ledger entries (admin view)
 */
export async function getLedgerEntries(limit: number = 50): Promise<any[]> {
    try {
        const { data, error } = await supabase
            .from('ledger_entries')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[admin-service] getLedgerEntries error:', err);
        return [];
    }
}

/**
 * Get webhook events
 */
export async function getWebhookEvents(limit: number = 50): Promise<any[]> {
    try {
        const { data, error } = await supabase
            .from('webhook_events')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[admin-service] getWebhookEvents error:', err);
        return [];
    }
}

/**
 * Get API keys
 */
export async function getApiKeys(limit: number = 50): Promise<any[]> {
    try {
        const { data, error } = await supabase
            .from('api_keys')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[admin-service] getApiKeys error:', err);
        return [];
    }
}

/**
 * Get settings
 */
export async function getSettings(): Promise<any[]> {
    try {
        const { data, error } = await supabase
            .from('settings')
            .select('*')
            .order('key');

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[admin-service] getSettings error:', err);
        return [];
    }
}

/**
 * Update setting
 */
export async function updateSetting(key: string, value: any, description?: string): Promise<boolean> {
    try {
        const { error } = await supabase
            .from('settings')
            .upsert({
                key,
                value,
                description: description || '',
                updated_at: new Date().toISOString(),
            });

        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[admin-service] updateSetting error:', err);
        return false;
    }
}
