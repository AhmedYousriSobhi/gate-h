import { HardDrive } from 'lucide-react'
import { MIN_STORAGE_INTERVAL_SEC } from '../../../../../shared/types'
import type { FormState, SetFormField } from '../formState'
import { SectionEmptyState, SectionToggleHeader } from './SectionChrome'

export default function StorageConfigSection({
  form,
  set
}: {
  form: FormState
  set: SetFormField
}): React.JSX.Element {
  return (
    <div className="form-section">
      <SectionToggleHeader
        icon={HardDrive}
        label="Storage quota"
        checked={form.useStorage}
        onChange={(checked) => set('useStorage', checked)}
      />
      {!form.useStorage ? (
        <SectionEmptyState icon={HardDrive}>
          Check filesystem usage and quota for specific paths on this cluster.
        </SectionEmptyState>
      ) : (
        <>
          <div className="form-field">
            <label htmlFor="storagePaths">Paths (comma separated)</label>
            <input
              id="storagePaths"
              placeholder="~, /scratch/$USER"
              value={form.storagePaths}
              onChange={(e) => set('storagePaths', e.target.value)}
            />
          </div>
          <p className="hint">
            Always available on request from the cluster&apos;s Status, on the terminal&apos;s open
            session: df for each filesystem, plus your quota on Lustre (lfs quota) and GPFS
            (mmlsquota).
          </p>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="storageInterval">Refresh every (seconds)</label>
              <input
                id="storageInterval"
                type="number"
                min={MIN_STORAGE_INTERVAL_SEC}
                value={form.storageInterval}
                onChange={(e) => set('storageInterval', e.target.value)}
              />
            </div>
            <label className="form-field-checkbox">
              <input
                type="checkbox"
                checked={form.storageAutoRefresh}
                onChange={(e) => set('storageAutoRefresh', e.target.checked)}
              />
              Refresh automatically
            </label>
          </div>
          {form.useTeleport && form.storageAutoRefresh && (
            <p className="hint">
              Every refresh is a new Teleport session in your site&apos;s audit log.
            </p>
          )}
        </>
      )}
    </div>
  )
}
