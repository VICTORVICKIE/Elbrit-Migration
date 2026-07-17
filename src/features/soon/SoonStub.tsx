import { Card } from '../../ui/Card'
import { PageHead } from '../../ui/Text'

export function SoonStub({ name }: { name: string }) {
  return (
    <div>
      <PageHead title={name} subtitle="Ecubix → ERPNext" />
      <Card className="border-dashed p-12 text-center">
        <p className="mb-1.5 font-semibold">Not configured yet</p>
        <p className="m-0 text-text-muted">
          The {name} migration flow will be enabled after Secondary is live. Add a config in Settings to enable.
        </p>
      </Card>
    </div>
  )
}
