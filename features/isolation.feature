Feature: Dev is isolated from prod
  Dev shares the cluster and the Gateway with prod. These scenarios run as the identity that deploys
  dev, which is deploy-dev in CI.

  Scenario: A dev route for a prod hostname is not accepted
    Given an HTTPRoute in dev for "isolation-test.cycsail.team"
    Then the Gateway doesn't accept the route

  Scenario: deploy-dev can deploy to dev
    Then I can create "deployments.apps" in namespace "dev"
    And I can create "httproutes.gateway.networking.k8s.io" in namespace "dev"

  Scenario Outline: deploy-dev can't create anything in another namespace
    Then I can't create "<resource>" in namespace "<namespace>"

    Examples:
      | resource                                | namespace   |
      | configmaps                              | default     |
      | deployments.apps                        | gateway     |
      | httproutes.gateway.networking.k8s.io    | gateway     |
      | gateways.gateway.networking.k8s.io      | gateway     |
      | secrets                                 | kube-system |
      | rolebindings.rbac.authorization.k8s.io  | prod        |

  Scenario Outline: deploy-dev can't create anything cluster-wide
    Then I can't create "<resource>" outside any namespace

    Examples:
      | resource                                      |
      | namespaces                                    |
      | clusterroles.rbac.authorization.k8s.io        |
      | clusterrolebindings.rbac.authorization.k8s.io |
