'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../../data/appStore'
import { ACCENT_CHOICES, FIXED_HEADER_FIELDS, normalizeHeaderMap } from '../../data/defaults'
import type { HeaderMapEntry } from '../../types'
import { DOCTYPE, erpClientFrom, fetchDocTypeFieldNames } from '../secondary/erpActions'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Checkbox } from '../../ui/Checkbox'
import { cn } from '../../ui/cn'
import { Field, Input } from '../../ui/Field'
import { SearchableMultiSelect } from '../../ui/Combobox'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Spinner } from '../../ui/Spinner'
import { Switch } from '../../ui/Switch'
import { TabsList, TabsPanel, TabsRoot, TabsTab } from '../../ui/Tabs'
import { Muted, PageHead, SectionLabel } from '../../ui/Text'

function MaskedInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex gap-1.5">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      <Button size="sm" type="button" onClick={() => setShow((s) => !s)}>
        {show ? 'Hide' : 'Show'}
      </Button>
    </div>
  )
}

const TAB_VALUES = ['credentials', 'configs', 'appearance']
const CONFIG_TAB_VALUES = ['secondary', 'visit', 'service', 'support']

export function SettingsPage() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tab = TAB_VALUES.includes(params.get('tab') ?? '') ? params.get('tab')! : 'credentials'

  return (
    <div>
      <PageHead title="Settings" subtitle="Stored in Firebase" />

      <TabsRoot value={tab} onValueChange={(v) => router.push(`${pathname}?tab=${v}`)}>
        <TabsList>
          <TabsTab value="credentials">Keys</TabsTab>
          <TabsTab value="configs">Configs</TabsTab>
          <TabsTab value="appearance">Appearance</TabsTab>
        </TabsList>

        <TabsPanel value="credentials">
          <CredentialsTab />
        </TabsPanel>
        <TabsPanel value="configs">
          <ConfigsTab />
        </TabsPanel>
        <TabsPanel value="appearance">
          <AppearanceTab />
        </TabsPanel>
      </TabsRoot>
    </div>
  )
}

function ConfigsTab() {
  const [tab, setTab] = useState('secondary')

  return (
    <div>
      <TabsRoot value={tab} onValueChange={setTab}>
        <TabsList>
          {CONFIG_TAB_VALUES.map((v) => (
            <TabsTab key={v} value={v} disabled={v !== 'secondary'} className="capitalize disabled:opacity-50">
              {v}
            </TabsTab>
          ))}
        </TabsList>

        <TabsPanel value="secondary">
          <SecondaryConfigTab />
        </TabsPanel>
        <TabsPanel value="visit">
          <ComingSoon name="Visit" />
        </TabsPanel>
        <TabsPanel value="service">
          <ComingSoon name="Service" />
        </TabsPanel>
        <TabsPanel value="support">
          <ComingSoon name="Support" />
        </TabsPanel>
      </TabsRoot>
    </div>
  )
}

function ComingSoon({ name }: { name: string }) {
  return <Muted className="block text-[12.5px]">{name} config unlocks after Secondary is live.</Muted>
}

function AppearanceTab() {
  const prefs = useAppStore((s) => s.prefs)
  const savePrefs = useAppStore((s) => s.savePrefs)

  return (
    <Card className="max-w-105 p-4.5">
      <div className="mb-4">
        <SectionLabel className="mb-2 block">Accent</SectionLabel>
        <div className="flex gap-2">
          {ACCENT_CHOICES.map((c) => (
            <button
              key={c}
              className={cn(
                'flex h-6.5 w-8.5 items-center justify-center rounded-md border-2 border-transparent text-xs text-white',
                prefs.accent === c && 'outline-2 outline-offset-1 outline-text',
              )}
              style={{ background: c }}
              onClick={() => void savePrefs({ ...prefs, accent: c })}
            >
              {prefs.accent === c ? '✓' : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-4">
        <SectionLabel className="mb-2 block">Table density</SectionLabel>
        <SegmentedControl
          value={prefs.density}
          onValueChange={(v) => void savePrefs({ ...prefs, density: v as 'comfortable' | 'compact' })}
          options={[
            { value: 'comfortable', label: 'comfortable' },
            { value: 'compact', label: 'compact' },
          ]}
        />
      </div>
      <div className="flex items-center justify-between">
        <SectionLabel>Issue hints</SectionLabel>
        <Switch
          checked={prefs.issueHints}
          onCheckedChange={(v) => void savePrefs({ ...prefs, issueHints: v })}
          aria-label="Toggle issue hints"
        />
      </div>
    </Card>
  )
}

function CredentialsTab() {
  const { credentials, saveCredentials } = useAppStore(
    useShallow((s) => ({ credentials: s.credentials, saveCredentials: s.saveCredentials })),
  )
  const [draft, setDraft] = useState(credentials)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [erpTest, setErpTest] = useState<string | null>(null)
  const [erpTesting, setErpTesting] = useState(false)

  async function testErp() {
    setErpTesting(true)
    setErpTest(null)
    const client = erpClientFrom(draft)
    if (!client) {
      setErpTest('Fill base URL, API key and secret first.')
      setErpTesting(false)
      return
    }
    const res = await client.testConnection()
    setErpTest(res.ok ? '✓ ' + res.message : '✗ ' + res.message)
    setErpTesting(false)
  }

  return (
    <div className="grid items-start gap-3.5">
      <Card className="max-w-105 p-4.5">
        <h3 className="mb-3">ERPNext</h3>
        <Field label="Base URL">
          <Input
            placeholder="https://erp.elbrit.org"
            value={draft.erpnext.baseUrl}
            onChange={(e) => setDraft({ ...draft, erpnext: { ...draft.erpnext, baseUrl: e.target.value } })}
          />
        </Field>
        <Field label="API key">
          <MaskedInput
            value={draft.erpnext.apiKey}
            onChange={(v) => setDraft({ ...draft, erpnext: { ...draft.erpnext, apiKey: v } })}
          />
        </Field>
        <Field label="API secret">
          <MaskedInput
            value={draft.erpnext.apiSecret}
            onChange={(v) => setDraft({ ...draft, erpnext: { ...draft.erpnext, apiSecret: v } })}
          />
        </Field>
        <Button size="sm" disabled={erpTesting} onClick={() => void testErp()}>
          {erpTesting ? 'Testing…' : 'Test connection'}
        </Button>
        {erpTest && <p className="mb-0 text-[12.5px]">{erpTest}</p>}
      </Card>

      <div className="col-span-full flex items-center gap-2.5">
        <Button
          variant="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            await saveCredentials(draft)
            setSaving(false)
            setSaved(true)
            setTimeout(() => setSaved(false), 2500)
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-[12.5px] text-status-synced">Saved.</span>}
      </div>
    </div>
  )
}

function SecondaryConfigTab() {
  const { credentials, secondaryConfig, saveSecondaryConfig } = useAppStore(
    useShallow((s) => ({
      credentials: s.credentials,
      secondaryConfig: s.secondaryConfig,
      saveSecondaryConfig: s.saveSecondaryConfig,
    })),
  )
  const [draft, setDraft] = useState(() => ({
    ...secondaryConfig,
    headerMap: normalizeHeaderMap(secondaryConfig.headerMap),
  }))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [erpFields, setErpFields] = useState<string[] | null>(null)
  const [erpFieldsError, setErpFieldsError] = useState<string | null>(null)
  const [erpFieldsLoading, setErpFieldsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const erp = erpClientFrom(credentials)
    if (!erp) {
      setErpFields(null)
      return
    }
    setErpFieldsError(null)
    setErpFieldsLoading(true)
    fetchDocTypeFieldNames(erp, DOCTYPE)
      .then((names) => {
        if (!cancelled) setErpFields(names)
      })
      .catch((e) => {
        if (!cancelled) setErpFieldsError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setErpFieldsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [credentials.erpnext.baseUrl, credentials.erpnext.apiKey, credentials.erpnext.apiSecret])

  function setHeader(field: HeaderMapEntry['field'], patch: Partial<HeaderMapEntry>) {
    const headerMap = draft.headerMap.map((h) => (h.field === field ? { ...h, ...patch } : h))
    setDraft({ ...draft, headerMap })
  }

  const erpFieldOptions = (erpFields ?? []).map((f) => ({ value: f, label: f }))

  const labelByField = new Map(FIXED_HEADER_FIELDS.map((f) => [f.field, f.label]))

  if (erpFieldsLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-15">
        <Spinner className="h-6 w-6" />
        <Muted className="text-[12.5px]">Loading {DOCTYPE} field options…</Muted>
      </div>
    )
  }

  return (
    <div>
      <Card className="mb-3.5">
        <div className="flex items-center justify-between p-3 px-4">
          <span className="font-semibold">Header → ERP field map</span>
        </div>
        {!erpClientFrom(credentials) && (
          <Muted className="block px-4 pb-3 text-[12.5px]">
            Connect ERPNext in the Keys &amp; credentials tab to load {DOCTYPE} field options.
          </Muted>
        )}
        {erpFieldsError && (
          <p className="px-4 pb-3 text-[12.5px] text-status-error">
            Could not load {DOCTYPE} fields from ERPNext: {erpFieldsError}
          </p>
        )}
        <div className="table-scroll">
          <table className="table-data">
            <thead>
              <tr>
                <th>Field</th>
                <th>Ecubix header</th>
                <th>ERP Field</th>
                <th>Required</th>
              </tr>
            </thead>
            <tbody>
              {draft.headerMap.map((h) => (
                <tr key={h.field}>
                  <td className="font-medium">{labelByField.get(h.field) ?? h.field}</td>
                  <td>
                    <Input
                      className="max-w-50 px-2 py-1"
                      value={h.ecubixHeader}
                      onChange={(e) => setHeader(h.field, { ecubixHeader: e.target.value })}
                    />
                  </td>
                  <td>
                    <SearchableMultiSelect
                      className="mono max-w-100 min-w-45 px-2 py-1"
                      value={h.erpFields}
                      disabled={!erpFields}
                      placeholder="Field(s)…"
                      onValueChange={(v) => setHeader(h.field, { erpFields: v })}
                      options={erpFieldOptions}
                    />
                  </td>
                  <td>
                    <Checkbox
                      checked={h.required}
                      onCheckedChange={(checked) => setHeader(h.field, { required: checked })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center gap-2.5">
        <Button
          variant="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            await saveSecondaryConfig(draft)
            setSaving(false)
            setSaved(true)
            setTimeout(() => setSaved(false), 2500)
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-[12.5px] text-status-synced">Saved.</span>}
      </div>
    </div>
  )
}
