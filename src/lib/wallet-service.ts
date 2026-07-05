/**
 * Wallet Service - محفظة الجنوب
 * Uses the Tappy infrastructure: wallets + ledger_entries tables
 * Multi-currency support: YER (base), SAR, USD
 */

import { supabase, supabaseService } from './supabase';

export type Currency = 'YER' | 'SAR' | 'USD';

export const CURRENCY_DECIMALS: Record<Currency, number> = {
    YER: 0,
    SAR: 2,
    USD: 2,
};

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
    YER: 'ر.ي',
    SAR: 'ر.س',
    USD: '$',
};

export const CURRENCY_RATES: Record<Currency, number> = {
    YER: 1,
    SAR: 0.037,
    USD: 0.0099,
};

export interface Wallet {
    id: string;
    user_id: string;
    currency: Currency;
    balance_minor: number;
    status: string;
    auto_reload: boolean;
    auto_reload_threshold_minor: number;
    auto_reload_amount_minor: number;
    created_at: string;
    updated_at: string;
}

export interface LedgerEntry {
    id: string;
    wallet_id: string;
    user_id: string;
    direction: 'credit' | 'debit';
    reason: string;
    amount_minor: number;
    balance_after_minor: number;
    reference?: string;
    transaction_id?: string;
    meta?: Record<string, any>;
    created_at: string;
}

/**
 * Convert major decimal amount to minor units (integer)
 */
export function toMinor(amount: number, currency: Currency = 'YER'): number {
    const decimals = CURRENCY_DECIMALS[currency];
    return Math.round(amount * Math.pow(10, decimals));
}

/**
 * Convert minor units to major decimal amount
 */
export function toDecimal(minor: number, currency: Currency = 'YER'): number {
    const decimals = CURRENCY_DECIMALS[currency];
    return minor / Math.pow(10, decimals);
}

/**
 * Format money for display
 */
export function formatMoney(minor: number, currency: Currency = 'YER'): string {
    const decimals = CURRENCY_DECIMALS[currency];
    const major = toDecimal(minor, currency);
    const formatted = major.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
    return `${formatted} ${CURRENCY_SYMBOLS[currency]}`;
}

/**
 * Convert from base currency (YER) to target currency
 */
export function convertFromBase(baseMinor: number, toCurrency: Currency): number {
    if (toCurrency === 'YER') return baseMinor;
    const rate = CURRENCY_RATES[toCurrency];
    const baseDecimals = CURRENCY_DECIMALS.YER;
    const targetDecimals = CURRENCY_DECIMALS[toCurrency];
    const baseMajor = baseMinor / Math.pow(10, baseDecimals);
    const targetMajor = baseMajor * rate;
    return Math.round(targetMajor * Math.pow(10, targetDecimals));
}

/**
 * Convert to base currency (YER) from given currency
 */
export function convertToBase(amountMinor: number, fromCurrency: Currency): number {
    if (fromCurrency === 'YER') return amountMinor;
    const rate = CURRENCY_RATES[fromCurrency];
    if (rate === 0) return amountMinor;
    const fromDecimals = CURRENCY_DECIMALS[fromCurrency];
    const baseDecimals = CURRENCY_DECIMALS.YER;
    const fromMajor = amountMinor / Math.pow(10, fromDecimals);
    const baseMajor = fromMajor / rate;
    return Math.round(baseMajor * Math.pow(10, baseDecimals));
}

/**
 * Get or create a wallet for a user in a specific currency
 */
export async function getOrCreateWallet(userId: string, currency: Currency = 'YER'): Promise<Wallet | null> {
    try {
        // First try to get existing wallet
        const { data: existing, error: fetchErr } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', userId)
            .eq('currency', currency)
            .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (existing) return existing as Wallet;

        // Create new wallet
        const { data: newWallet, error: insertErr } = await supabase
            .from('wallets')
            .insert({
                user_id: userId,
                currency,
                balance_minor: 0,
                status: 'active',
            })
            .select()
            .single();

        if (insertErr) throw insertErr;
        return newWallet as Wallet;
    } catch (err) {
        console.error('[wallet-service] getOrCreateWallet error:', err);
        return null;
    }
}

/**
 * Get all wallets for a user
 */
export async function getUserWallets(userId: string): Promise<Wallet[]> {
    try {
        const { data, error } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', userId)
            .order('currency');

        if (error) throw error;
        return (data || []) as Wallet[];
    } catch (err) {
        console.error('[wallet-service] getUserWallets error:', err);
        return [];
    }
}

/**
 * Credit (add funds to) a wallet
 */
export async function creditWallet(
    userId: string,
    currency: Currency,
    amountMinor: number,
    reason: string,
    options?: { reference?: string; transactionId?: string; meta?: Record<string, any>; idempotencyKey?: string }
): Promise<{ success: boolean; entry?: LedgerEntry; error?: string }> {
    try {
        const wallet = await getOrCreateWallet(userId, currency);
        if (!wallet) return { success: false, error: 'Wallet not found' };

        const newBalance = wallet.balance_minor + amountMinor;

        const { data: entry, error } = await supabase
            .from('ledger_entries')
            .insert({
                wallet_id: wallet.id,
                user_id: userId,
                direction: 'credit',
                reason,
                amount_minor: amountMinor,
                balance_after_minor: newBalance,
                reference: options?.reference,
                transaction_id: options?.transactionId,
                meta: options?.meta || {},
                idempotency_key: options?.idempotencyKey,
            })
            .select()
            .single();

        if (error) throw error;

        // Update wallet balance
        const { error: updateErr } = await supabase
            .from('wallets')
            .update({ balance_minor: newBalance, updated_at: new Date().toISOString() })
            .eq('id', wallet.id);

        if (updateErr) throw updateErr;

        return { success: true, entry: entry as LedgerEntry };
    } catch (err: any) {
        console.error('[wallet-service] creditWallet error:', err);
        return { success: false, error: err.message || 'Failed to credit wallet' };
    }
}

/**
 * Debit (remove funds from) a wallet
 */
export async function debitWallet(
    userId: string,
    currency: Currency,
    amountMinor: number,
    reason: string,
    options?: { reference?: string; transactionId?: string; meta?: Record<string, any>; idempotencyKey?: string }
): Promise<{ success: boolean; entry?: LedgerEntry; error?: string }> {
    try {
        const wallet = await getOrCreateWallet(userId, currency);
        if (!wallet) return { success: false, error: 'Wallet not found' };

        if (wallet.balance_minor < amountMinor) {
            return { success: false, error: 'Insufficient funds' };
        }

        const newBalance = wallet.balance_minor - amountMinor;

        const { data: entry, error } = await supabase
            .from('ledger_entries')
            .insert({
                wallet_id: wallet.id,
                user_id: userId,
                direction: 'debit',
                reason,
                amount_minor: amountMinor,
                balance_after_minor: newBalance,
                reference: options?.reference,
                transaction_id: options?.transactionId,
                meta: options?.meta || {},
                idempotency_key: options?.idempotencyKey,
            })
            .select()
            .single();

        if (error) throw error;

        // Update wallet balance
        const { error: updateErr } = await supabase
            .from('wallets')
            .update({ balance_minor: newBalance, updated_at: new Date().toISOString() })
            .eq('id', wallet.id);

        if (updateErr) throw updateErr;

        return { success: true, entry: entry as LedgerEntry };
    } catch (err: any) {
        console.error('[wallet-service] debitWallet error:', err);
        return { success: false, error: err.message || 'Failed to debit wallet' };
    }
}

/**
 * Get ledger entries for a user
 */
export async function getLedgerEntries(userId: string, limit: number = 20): Promise<LedgerEntry[]> {
    try {
        const { data, error } = await supabase
            .from('ledger_entries')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return (data || []) as LedgerEntry[];
    } catch (err) {
        console.error('[wallet-service] getLedgerEntries error:', err);
        return [];
    }
}

/**
 * Get commission rules
 */
export async function getCommissionRules(productType?: string): Promise<any[]> {
    try {
        let query = supabase
            .from('commission_rules')
            .select('*')
            .eq('is_active', true)
            .order('priority', { ascending: false });

        if (productType) {
            query = query.eq('product_type', productType);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[wallet-service] getCommissionRules error:', err);
        return [];
    }
}
