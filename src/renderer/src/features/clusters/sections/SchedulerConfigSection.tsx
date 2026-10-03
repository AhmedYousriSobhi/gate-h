import { ListChecks } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { SchedulerScope } from '../../../../../shared/types'
import { MIN_SCHEDULER_INTERVAL_SEC } from '../../../../../shared/types'
import type { FormState, SetFormField } from '../formState'
import { SectionEmptyState, SectionToggleHeader } from './SectionChrome'

export default function SchedulerConfigSection({
  form,
  set,
  setForm
}: {
  form: FormState
  set: SetFormField
  setForm: Dispatch<SetStateAction<FormState>>
}): React.JSX.Element {
  return (
    <div className="form-section">
      <SectionToggleHeader
        icon={ListChecks}
        label="Slurm jobs and nodes"
        checked={form.useScheduler}
        onChange={(checked) =>
          setForm((prev) => ({
            ...prev,
            useScheduler: checked,
            // Each run on a Teleport cluster is an audited session - opt in explicitly.
            schedulerAutoRefresh: checked ? !prev.useTeleport : prev.schedulerAutoRefresh
          }))
        }
      />
      {!form.useScheduler ? (
        <SectionEmptyState icon={ListChecks}>
          Show the user&apos;s Slurm jobs and node health from this cluster&apos;s terminal session.
        </SectionEmptyState>
      ) : (
        <>
          <p className="hint">
            Runs squeue and sinfo on the terminal&apos;s open session - never a new login - and only
            while this cluster&apos;s Status is showing. See docs/HPC_ORCHESTRATION.md.
          </p>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="schedulerScope">Show</label>
              <select
                id="schedulerScope"
                value={form.schedulerScope}
                onChange={(e) => set('schedulerScope', e.target.value as SchedulerScope)}
              >
                <option value="mine">My jobs</option>
                <option value="partitions">Everyone&apos;s jobs</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="schedulerPartitions">Only query these partitions (optional)</label>
              <input
                id="schedulerPartitions"
                placeholder="Blank = all partitions (filter in the Status panel)"
                value={form.schedulerPartitions}
                onChange={(e) => set('schedulerPartitions', e.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="schedulerInterval">Refresh every (seconds)</label>
              <input
                id="schedulerInterval"
                type="number"
                min={MIN_SCHEDULER_INTERVAL_SEC}
                value={form.schedulerInterval}
                onChange={(e) => set('schedulerInterval', e.target.value)}
              />
            </div>
            <label className="form-field-checkbox">
              <input
                type="checkbox"
                checked={form.schedulerAutoRefresh}
                onChange={(e) => set('schedulerAutoRefresh', e.target.checked)}
              />
              Refresh automatically
            </label>
          </div>
          {!form.useTeleport && (
            <label className="form-field-checkbox">
              <input
                type="checkbox"
                checked={form.schedulerNotify}
                onChange={(e) => set('schedulerNotify', e.target.checked)}
              />
              Notify me when my jobs finish or start, and when nodes go down
            </label>
          )}
          {!form.useTeleport && form.schedulerNotify && (
            <p className="hint">
              While this cluster is open in the background, Gate-H keeps checking every 5 minutes on
              its terminal&apos;s connection. Closed or in standby, nothing runs.
            </p>
          )}
          {form.useTeleport && form.schedulerAutoRefresh && (
            <p className="hint">
              Every refresh is a new Teleport session in your site&apos;s audit log.
            </p>
          )}
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="schedulerExecHost">
                Run Slurm commands on a different node (optional)
              </label>
              <input
                id="schedulerExecHost"
                placeholder="Blank = the terminal's own node"
                value={form.schedulerExecHost}
                onChange={(e) => set('schedulerExecHost', e.target.value)}
              />
            </div>
            {form.schedulerExecHost.trim() && (
              <div className="form-field">
                <label htmlFor="schedulerExecPort">Port (optional)</label>
                <input
                  id="schedulerExecPort"
                  placeholder={form.port || '22'}
                  value={form.schedulerExecPort}
                  onChange={(e) => set('schedulerExecPort', e.target.value)}
                />
              </div>
            )}
          </div>
          <p className="hint">
            A hostname, not a command. Once connected, Gate-H runs <code>ssh &lt;node&gt;</code>{' '}
            from the terminal&apos;s node and collects squeue/sinfo there. That is your login
            node&apos;s own ssh, so it needs passwordless ssh (a key or agent) from that node to
            this one, and the name must resolve from there. Leave it blank if squeue/sinfo work on
            the terminal&apos;s own node.
          </p>
        </>
      )}
    </div>
  )
}
