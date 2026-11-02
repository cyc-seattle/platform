/** A Kubernetes quantity, in millicores for CPU ("250m", "1") or MiB for memory ("768Mi", "2Gi"). */
function amount(quantity: string): number {
  const units: Record<string, number> = { m: 1, Mi: 1, Gi: 1024 };
  const unit = Object.keys(units).find((suffix) => quantity.endsWith(suffix));
  return unit ? Number(quantity.slice(0, -unit.length)) * units[unit]! : Number(quantity) * 1000;
}

/**
 * The containers Autopilot would admit with larger requests than Pulumi sets. A pod that sets
 * `safe-to-evict: "false"` runs as extended duration, whose requests are at least 500m CPU and 512Mi
 * (docs.cloud.google.com/kubernetes-engine/docs/concepts/autopilot-resource-requests). Pulumi sets a
 * smaller request back on every deploy, so each preview shows a change that does nothing.
 */
export function requestsAutopilotRaises(
  resources: { type: string; name: string; inputs: Record<string, any> }[], // eslint-disable-line @typescript-eslint/no-explicit-any
): string[] {
  return resources
    .filter((r) => r.type === "kubernetes:apps/v1:Deployment" || r.type === "kubernetes:batch/v1:CronJob")
    .flatMap((r) => {
      const template = r.type.endsWith("CronJob")
        ? r.inputs["spec"].jobTemplate.spec.template
        : r.inputs["spec"].template;
      if (template.metadata?.annotations?.["cluster-autoscaler.kubernetes.io/safe-to-evict"] !== "false") {
        return [];
      }
      return (
        template.spec.containers as { name: string; resources?: { requests?: { cpu?: string; memory?: string } } }[]
      )
        .filter(({ resources }) => {
          const { cpu, memory } = resources?.requests ?? {};
          return (typeof cpu === "string" && amount(cpu) < 500) || (typeof memory === "string" && amount(memory) < 512);
        })
        .map(({ name }) => `${r.name}/${name}`);
    });
}
