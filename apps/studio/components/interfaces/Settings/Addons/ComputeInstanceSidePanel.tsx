import { PermissionAction } from '@supabase/shared-types/out/constants'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Info } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useParams } from 'common'
import {
  useIsProjectActive,
  useProjectContext,
} from 'components/layouts/ProjectLayout/ProjectContext'
import { setProjectStatus } from 'data/projects/projects-query'
import { MAX_REPLICAS_BELOW_XL, useReadReplicasQuery } from 'data/read-replicas/replicas-query'
import { useOrgSubscriptionQuery } from 'data/subscriptions/org-subscription-query'
import { useProjectAddonRemoveMutation } from 'data/subscriptions/project-addon-remove-mutation'
import { useProjectAddonUpdateMutation } from 'data/subscriptions/project-addon-update-mutation'
import { useProjectAddonsQuery } from 'data/subscriptions/project-addons-query'
import type { AddonVariantId, ProjectAddonVariantMeta } from 'data/subscriptions/types'
import { useCheckPermissions } from 'hooks/misc/useCheckPermissions'
import { useSelectedOrganization } from 'hooks/misc/useSelectedOrganization'
import { useFlag } from 'hooks/ui/useFlag'
import { getCloudProviderArchitecture } from 'lib/cloudprovider-utils'
import { INSTANCE_MICRO_SPECS, PROJECT_STATUS } from 'lib/constants'
import { useAddonsPagePanel } from 'state/addons-page'
import {
  Alert,
  Alert_Shadcn_,
  AlertDescription_Shadcn_,
  AlertTitle_Shadcn_,
  Badge,
  Button,
  Modal,
  Radio,
  SidePanel,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  WarningIcon,
} from 'ui'

const ComputeInstanceSidePanel = () => {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { ref: projectRef } = useParams()
  const { project: selectedProject } = useProjectContext()
  const organization = useSelectedOrganization()
  const computeSizeChangesDisabled = useFlag('disableComputeSizeChanges')
  const diskAndComputeForm = useFlag('diskAndComputeForm')
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  const canUpdateCompute = useCheckPermissions(
    PermissionAction.BILLING_WRITE,
    'stripe.subscriptions'
  )
  const isProjectActive = useIsProjectActive()
  const { panel, setPanel, closePanel } = useAddonsPagePanel()
  const visible = panel === 'computeInstance'

  const { data: databases } = useReadReplicasQuery({ projectRef }, { enabled: visible })
  const { data: addons, isLoading } = useProjectAddonsQuery({ projectRef }, { enabled: visible })
  const { data: subscription } = useOrgSubscriptionQuery(
    { orgSlug: organization?.slug },
    { enabled: visible }
  )
  const { mutate: updateAddon, isLoading: isUpdating } = useProjectAddonUpdateMutation({
    onSuccess: () => {
      toast.success(
        `Successfully updated compute instance to ${selectedCompute?.name}. Your project is currently being restarted to update its instance`,
        { duration: 8000 }
      )
      setProjectStatus(queryClient, projectRef!, PROJECT_STATUS.RESIZING)
      closePanel()
      router.push(`/project/${projectRef}`)
    },
    onError: (error) => {
      toast.error(`Unable to update compute instance: ${error.message}`)
    },
  })
  const { mutate: removeAddon, isLoading: isRemoving } = useProjectAddonRemoveMutation({
    onSuccess: () => {
      toast.success(
        `Successfully updated compute instance. Your project is currently being restarted to update its instance`,
        { duration: 8000 }
      )
      setProjectStatus(queryClient, projectRef!, PROJECT_STATUS.RESIZING)
      closePanel()
      router.push(`/project/${projectRef}`)
    },
    onError: (error) => {
      toast.error(`Unable to update compute instance: ${error.message}`)
    },
  })

  const [selectedOption, setSelectedOption] = useState<string>('')

  const isSubmitting = isUpdating || isRemoving
  const projectId = selectedProject?.id
  const cpuArchitecture = getCloudProviderArchitecture(selectedProject?.cloud_provider)
  const selectedAddons = addons?.selected_addons ?? []
  const availableAddons = useMemo(() => {
    return addons?.available_addons ?? []
  }, [addons])

  const isFreePlan = subscription?.plan?.id === 'free'
  const subscriptionCompute = selectedAddons.find((addon) => addon.type === 'compute_instance')
  const pitrAddon = selectedAddons.find((addon) => addon.type === 'pitr')

  const hasMicroOptionFromApi = useMemo(() => {
    return (
      availableAddons.find((addon) => addon.type === 'compute_instance')?.variants ?? []
    ).some((variant) => variant.identifier === 'ci_micro')
  }, [availableAddons])

  const availableOptions = useMemo(() => {
    const computeOptions =
      availableAddons
        .find((addon) => addon.type === 'compute_instance')
        ?.variants.filter((option) => {
          if (!selectedProject?.cloud_provider) {
            return true
          }

          const meta = option.meta as ProjectAddonVariantMeta

          return (
            !meta.supported_cloud_providers ||
            meta.supported_cloud_providers.includes(selectedProject.cloud_provider)
          )
        }) ?? []

    // Backwards comp until API is deployed
    if (!hasMicroOptionFromApi) {
      // Unshift to push to start of array
      computeOptions.unshift({
        identifier: 'ci_micro',
        name: 'Micro',
        price_description: '$0.01344/hour (~$10/month)',
        price: 0.01344,
        price_interval: 'hourly',
        price_type: 'usage',
        // @ts-ignore API types it as Record<string, never>
        meta: {
          cpu_cores: INSTANCE_MICRO_SPECS.cpu_cores,
          cpu_dedicated: INSTANCE_MICRO_SPECS.cpu_dedicated,
          memory_gb: INSTANCE_MICRO_SPECS.memory_gb,
          baseline_disk_io_mbs: INSTANCE_MICRO_SPECS.baseline_disk_io_mbs,
          max_disk_io_mbs: INSTANCE_MICRO_SPECS.max_disk_io_mbs,
          connections_direct: INSTANCE_MICRO_SPECS.connections_direct,
          connections_pooler: INSTANCE_MICRO_SPECS.connections_pooler,
        } as ProjectAddonVariantMeta,
      })
    }

    return computeOptions
  }, [availableAddons, hasMicroOptionFromApi])

  const defaultInstanceSize = useMemo(() => {
    if (!selectedProject) return ''

    return selectedProject.infra_compute_size === 'nano' ? 'ci_nano' : 'ci_micro'
  }, [selectedProject])

  const selectedCompute = availableOptions.find((option) => option.identifier === selectedOption)
  const hasChanges =
    selectedOption !== (subscriptionCompute?.variant.identifier ?? defaultInstanceSize)
  const numReadReplicas = (databases ?? []).filter((db) => db.identifier !== projectRef).length
  const hasReadReplicas = numReadReplicas > 0

  const isDowngradingToBelowSmall = ['ci_micro', 'ci_nano'].includes(selectedOption)
  const blockDowngradeDueToPitr = pitrAddon !== undefined && isDowngradingToBelowSmall && hasChanges
  const hasMoreThanTwoReplicasForXLAndAbove =
    numReadReplicas > MAX_REPLICAS_BELOW_XL &&
    ['ci_micro', 'ci_small', 'ci_medium', 'ci_large'].includes(selectedOption)
  const blockDowngradeDueToReadReplicas =
    hasChanges &&
    hasReadReplicas &&
    (isDowngradingToBelowSmall || hasMoreThanTwoReplicasForXLAndAbove)

  const onConfirmUpdateComputeInstance = async () => {
    if (!projectRef) return console.error('Project ref is required')
    if (!projectId) return console.error('Project ID is required')
    if (computeSizeChangesDisabled)
      toast.error(
        'Compute size changes are currently disabled - our engineers are working on a fix.'
      )

    // Temporary backwards compatibility fix
    if (
      !hasMicroOptionFromApi &&
      selectedOption === 'ci_micro' &&
      subscriptionCompute !== undefined
    ) {
      removeAddon({ projectRef, variant: subscriptionCompute.variant.identifier })
    } else {
      updateAddon({
        projectRef,
        type: 'compute_instance',
        variant: selectedOption as AddonVariantId,
      })
    }
  }

  useEffect(() => {
    if (visible) {
      if (subscriptionCompute !== undefined) {
        setSelectedOption(subscriptionCompute.variant.identifier)
      } else {
        setSelectedOption(defaultInstanceSize)
      }
    }
  }, [visible, isLoading])

  useEffect(() => {
    if (visible && diskAndComputeForm) {
      router.push(`/project/${projectRef}/settings/compute-and-disk`)
    }
  }, [visible, diskAndComputeForm, router, projectRef])

  return (
    <>
      <SidePanel
        size="xxlarge"
        visible={visible}
        onCancel={closePanel}
        onConfirm={() => setShowConfirmationModal(true)}
        loading={isLoading}
        disabled={
          isFreePlan ||
          isLoading ||
          !hasChanges ||
          blockDowngradeDueToPitr ||
          blockDowngradeDueToReadReplicas ||
          !canUpdateCompute ||
          !isProjectActive
        }
        tooltip={
          isFreePlan
            ? 'Unable to update compute instance on a Free Plan'
            : !isProjectActive
              ? 'Unable to update compute as project is currently not active'
              : !canUpdateCompute
                ? 'You do not have permission to update compute instance'
                : undefined
        }
        header={
          <div className="flex items-center justify-between">
            <h4>Change project compute size</h4>
            <Button asChild type="default" icon={<ExternalLink strokeWidth={1.5} />}>
              <Link
                href="https://supabase.com/docs/guides/platform/compute-add-ons"
                target="_blank"
                rel="noreferrer"
              >
                About compute sizes
              </Link>
            </Button>
          </div>
        }
      >
        <SidePanel.Content>
          <div className="py-6 space-y-4">
            {selectedProject?.infra_compute_size === 'nano' && subscription?.plan.id !== 'free' && (
              <Alert_Shadcn_ variant="default">
                <Info strokeWidth={2} />
                <AlertTitle_Shadcn_>Free compute upgrade to Micro</AlertTitle_Shadcn_>
                <AlertDescription_Shadcn_>
                  Paid Plans include a free upgrade to Micro compute. Your project is ready to
                  upgrade for no additional charges.
                </AlertDescription_Shadcn_>
              </Alert_Shadcn_>
            )}

            <p className="text-sm">
              For the database, compute size refers to the amount of CPU and memory allocated to the
              database instance.
            </p>

            <div className="pb-4">
              {isFreePlan && (
                <Alert
                  withIcon
                  className="mb-4"
                  variant="info"
                  title="Changing your compute size is only available on the Pro Plan"
                  actions={
                    <Button asChild type="default">
                      <Link
                        href={`/org/${organization?.slug}/billing?panel=subscriptionPlan&source=computeInstanceSidePanel`}
                      >
                        View available plans
                      </Link>
                    </Button>
                  }
                >
                  Upgrade your plan to change the compute size of your project
                </Alert>
              )}
              <Radio.Group
                type="large-cards"
                size="tiny"
                id="compute-instance"
                label={<p className="text-sm">Choose the compute size you want to use</p>}
                onChange={(event: any) => setSelectedOption(event.target.value)}
              >
                {availableOptions.map((option) => (
                  <Radio
                    className="col-span-3 !p-0"
                    disabled={isFreePlan}
                    name="compute-instance"
                    key={option.identifier}
                    checked={selectedOption === option.identifier}
                    label={option.name}
                    value={option.identifier}
                  >
                    <div className="w-full group">
                      <div className="border-b border-default px-4 py-2">
                        <p className="text-sm flex justify-between">
                          {option.name}{' '}
                          {(subscriptionCompute?.variant.identifier === option.identifier ||
                            (!subscriptionCompute &&
                              option.identifier ===
                                `ci_${selectedProject?.infra_compute_size}`)) && (
                            <Badge>Current</Badge>
                          )}
                          {selectedProject?.infra_compute_size === 'nano' &&
                            option.identifier === 'ci_micro' && <Badge>Free Upgrade</Badge>}
                        </p>
                      </div>
                      <div className="px-4 py-2">
                        <p className="text-foreground-light">
                          {option.meta?.memory_gb ?? 0} GB memory
                        </p>
                        <p className="text-foreground-light">
                          {option.meta?.cpu_cores ?? 0}-core {cpuArchitecture} CPU (
                          {option.meta?.cpu_dedicated ? 'Dedicated' : 'Shared'})
                        </p>
                        <div className="flex justify-between items-center mt-2">
                          <div className="flex items-center space-x-1">
                            <span className="text-foreground text-sm">
                              {/* Price needs to be exact here */}${option.price}
                            </span>
                            <span className="text-foreground-light translate-y-[1px]">
                              {' '}
                              / {option.price_interval === 'monthly' ? 'month' : 'hour'}
                            </span>
                          </div>
                          {option.price_interval === 'hourly' && (
                            <Tooltip>
                              <TooltipTrigger>
                                <Info
                                  size={14}
                                  strokeWidth={2}
                                  className="hover:text-foreground-light"
                                />
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                ${Number(option.price * 672).toFixed(0)} - $
                                {Number(option.price * 744).toFixed(0)} per month
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </div>
                  </Radio>
                ))}
              </Radio.Group>
            </div>

            {hasChanges && (
              <p className="text-sm text-foreground-light">
                There are no immediate charges when changing compute. Compute Hours are a
                usage-based item and you're billed at the end of your billing cycle based on your
                compute usage. Read more about{' '}
                <Link
                  href="https://supabase.com/docs/guides/platform/manage-your-usage/compute"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Compute Billing
                </Link>
                .
              </p>
            )}

            {hasChanges && !blockDowngradeDueToPitr && !blockDowngradeDueToReadReplicas && (
              <Alert_Shadcn_>
                <WarningIcon />
                <AlertTitle_Shadcn_>
                  Your project will need to be restarted when changing its compute size
                </AlertTitle_Shadcn_>
                <AlertDescription_Shadcn_>
                  Your project will be unavailable for up to 2 minutes while the changes take place.
                </AlertDescription_Shadcn_>
                {hasReadReplicas && (
                  <AlertDescription_Shadcn_>
                    The compute sizes for <span className="text-foreground">all read replicas</span>{' '}
                    on your project will also be changed to the {selectedCompute?.name} size as
                    well.
                  </AlertDescription_Shadcn_>
                )}
              </Alert_Shadcn_>
            )}

            {blockDowngradeDueToReadReplicas ? (
              <Alert_Shadcn_>
                <WarningIcon />
                <AlertTitle_Shadcn_>
                  {hasMoreThanTwoReplicasForXLAndAbove && selectedOption !== 'ci_micro'
                    ? `Unable to downgrade as project has more than ${MAX_REPLICAS_BELOW_XL} read replicas`
                    : 'Unable to downgrade as project has active read replicas'}
                </AlertTitle_Shadcn_>
                <AlertDescription_Shadcn_>
                  {hasMoreThanTwoReplicasForXLAndAbove && selectedOption !== 'ci_micro'
                    ? `You can only have up to ${MAX_REPLICAS_BELOW_XL} read replicas for compute sizes below XL, as such you will need to remove at least ${numReadReplicas - MAX_REPLICAS_BELOW_XL} read replica${numReadReplicas - MAX_REPLICAS_BELOW_XL > 1 ? 's' : ''} before downgrading your compute.`
                    : 'The minimum compute size for using read replicas is the Small Compute. You need to remove all read replicas before downgrading Compute as it requires at least a Small compute instance.'}
                </AlertDescription_Shadcn_>
                <AlertDescription_Shadcn_ className="mt-2">
                  <Button asChild type="default">
                    <Link
                      href={`/project/${projectRef}/settings/infrastructure`}
                      onClick={closePanel}
                    >
                      Manage read replicas
                    </Link>
                  </Button>
                </AlertDescription_Shadcn_>
              </Alert_Shadcn_>
            ) : blockDowngradeDueToPitr ? (
              <Alert_Shadcn_>
                <WarningIcon />
                <AlertTitle_Shadcn_>Disable PITR before downgrading</AlertTitle_Shadcn_>
                <AlertDescription_Shadcn_>
                  You currently have PITR enabled. The minimum compute size for using PITR is the
                  Small Compute.
                </AlertDescription_Shadcn_>
                <AlertDescription_Shadcn_>
                  You need to disable PITR before downgrading Compute as it requires at least a
                  Small compute instance.
                </AlertDescription_Shadcn_>
                <AlertDescription_Shadcn_ className="mt-2">
                  <Button type="default" onClick={() => setPanel('pitr')}>
                    Change PITR
                  </Button>
                </AlertDescription_Shadcn_>
              </Alert_Shadcn_>
            ) : null}
          </div>
        </SidePanel.Content>
      </SidePanel>

      <Modal
        size="medium"
        alignFooter="right"
        visible={showConfirmationModal}
        loading={isSubmitting}
        onCancel={() => setShowConfirmationModal(false)}
        onConfirm={() => onConfirmUpdateComputeInstance()}
        header="Confirm to upgrade compute instance now"
      >
        <Modal.Content>
          <Alert
            withIcon
            variant="warning"
            title="Your project will need to be restarted when changing its compute size"
          >
            Your project will be unavailable for up to 2 minutes while the changes take place.
          </Alert>
        </Modal.Content>
      </Modal>
    </>
  )
}

export default ComputeInstanceSidePanel
