import React, { useEffect, useState } from 'react';
import { VoiceIdentitySourceValidationView } from './VoiceIdentitySourceValidationView';
import { VoiceIdentityValidationView } from './VoiceIdentityValidationView';

/** 按已持久化的来源选择验证策略，避免依赖浏览器缓存或路由猜测。 */
export function VoiceIdentityValidationEntry({ id, batchId, onAiBack, onSourceBack }: { id: string; batchId: string; onAiBack: () => void; onSourceBack: () => void }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    fetch(`/api/voice-identities/${encodeURIComponent(id)}`)
      .then(response => response.ok ? response.json() as Promise<{ identity: { source: string } }> : Promise.reject(new Error('无法读取声音角色。')))
      .then(body => { if (live) setSource(body.identity.source); })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : '无法读取声音角色。'); });
    return () => { live = false; };
  }, [id]);
  if (error) return <main className="sv-page"><div className="sv-feedback">{error}</div></main>;
  if (!source) return <main className="sv-page"><div className="sv-feedback">正在加载验证策略…</div></main>;
  return source === 'AI 原创设计'
    ? <VoiceIdentityValidationView id={id} batchId={batchId} onBack={onAiBack} />
    : <VoiceIdentitySourceValidationView id={id} onBack={onSourceBack} />;
}
