+++
title = "Kubernetes security for application developers"
date = 2020-06-18
+++

> Kubernetes brought a lot of innovation into the application
> development and operations, these changes have effects on
> application and infrastructure security. It might be hard to reason
> about kubernetes security since this problem have to be addressed on
> multiple layers. In this post I will provide overview and references
> to the available security tools and procedures from the application
> developer perspective.

As mentioned in the [official
documentation](https://kubernetes.io/docs/concepts/security/overview/)
it might be easier to reason about application security on kubernetes
by separating this problem into multiple layers:

- Infrastructure. This level is a foundation of a cluster and it
  includes typical server isolation and security procedures. `k8s`
  specific problems include proper network isolation for the
  communications between the control plane, nodes and `etcd`
  deployment.
  
- Cluster. This level address security of a `k8s` distribution and
  it's components: TLS encryption setup for communications between
  components, authenticating and authorizing requests to a `k8s` API
  and other `k8s` settings that can affect deployed applications.
  
- Container runtime. On this level we asses vulnerabilities inside
  container images, trust chain between hosts and image repositories,
  container runtime settings that allow escaping from the container's
  namespace.
  
- Application. This is the field most developers will be familiar
  with. `k8s` provides several tools that directly impact
  application's runtime and it might be useful to familiarize with
  those.
  
I will go through each level below and will try to highlight things
that I think is important to be aware of.
  
## Infrastructure

Infrastructure security is a complex field but a lot of problems in
this level are not entirely unique to `k8s`. Kubernetes nodes and
control plane servers should still adhere to security procedures of
regular deployments. This means that OS and software should be up to
date, servers should have a proper network isolation and security
tools provided by OS or infrastructure provider should be used. This
level is a foundation for other layers: if it will be possible to
break into a host it will be possible to avoid security mechanisms
from other levels.

It's important to properly isolate control plane and nodes, ensure
that APIs of the control plane's processes as well as `kubelet` are
not exposed to public networks. Process for setting up network rules
will vary depending on the deployment but general guidance is provided
in the [Accessing
Clusters](https://kubernetes.io/docs/reference/access-authn-authz/controlling-access/#api-server-ports-and-ips)
section.

Kernel's [audit](https://wiki.archlinux.org/index.php/Audit_framework)
module or [falco](https://falco.org/) can be a used for monitoring
security related events on hosts.

## Cluster

Cluster security can be hard to reason about and will require quite a
bit of knowledge about kubernetes administration. Good starting points
for this is the [Concepts](https://kubernetes.io/docs/concepts/) and
the [Securing a
cluster](https://kubernetes.io/docs/concepts/cluster-administration/cluster-administration-overview/#securing-a-cluster)
sections of the official administration guide. I found the [Kubernetes
The Hard
Way](https://github.com/kelseyhightower/kubernetes-the-hard-way) to be
a useful tool to get familiar with `k8s` components and setup
procedures, it includes a good walkthrough for the base security
settings.

Using managed `k8s` distribution will most likely provide the sane
security defaults but will not protect cluster from applying unsafe
configurations values to the
`kubelet`. [kube-bench](https://github.com/aquasecurity/kube-bench)
can be used for auditing such settings automatically. All `kube-bench`
checks are also published as a separate checklist style document, it
can be used as a reference for potential security misconfigurations.

The [Control Plane-Node
 Communication](https://kubernetes.io/docs/concepts/architecture/control-plane-node-communication/)
 section of the documentation is a good starting point for securing
 `k8s` communication channels. The main highlights from that section:
 TLS should be properly setup and enforced, certificate validation for
 API server to `kubelet` communication has to be enabled explicitly,
 appropriate authentication and authorization mechanisms should be
 used for all API requests, additional measures might be necessary for
 API server to nodes, pods and services communication.

Beyond control plane and node settings it's important get familiar
with [RBAC
authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
and use fine-grained restrictive roles often to minimize security
risks when tokens are leaked.

[falco](https://falco.org/) also provides a good integration with the
`k8s` audit log and supports alerting rules if necessary.

## Container runtime

It's important to ensure that containers are providing safe runtime
for applications, containers using expected images and it's not
possible to escape from container's namespace.

A lot of the security procedures for a host OS also apply to a
container OS. Using static analysis for images with
[clair](https://github.com/quay/clair) or
[trivy](https://github.com/aquasecurity/trivy) will help automating
some of those checks. Some of the problems may be avoided by using
OS-less base images like `scratch` for statically compiled language or
by using minimal images provided by
[distroless](https://github.com/GoogleContainerTools/distroless)
project.

It's important to ensure that pulled images were not altered after the
build, most container runtimes provide a way verify signatures of
images. For docker registries and images you can follow [Docker
Content
Trust](https://docs.docker.com/engine/security/trust/content_trust/)
guide.

It's possible to escape container's namespace or get control over the
container runtime daemon with privileged permissions, elevated
capabilities or certain host mounts. This enables large number of
attacks: from taking control over container runtime to potentially
being able to reconfigure cluster settings. [Pod Security
Policy](https://kubernetes.io/docs/concepts/policy/pod-security-policy/)
can be used to prevent this across a cluster.

## Application runtime

Application runtime protection quite often falls into domain of
application developers. I'm not going to focus on common application
security techniques like static and dynamic analysis but instead will
highlight `k8s` tools and settings that can be used to strengthen
application runtime.

As mentioned above setting up `RBAC` accounts with minimal permissions
per deployment will minimize impact if such credentials will be
leaked. Such accounts work well with other security features like
`PSP`. Applications that require `cluster-admin` role (Kubernetes
dashboard for example) should be properly secured or avoided where
possible.

All pods [automatically
receive](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#use-the-default-service-account-to-access-the-api-server)
service account credentials which give pods access to the API
server. In many cases pods don't require these credentials, it's
recommended to set `automountServiceAccountToken: false` on all
resources unless such credentials are necessary.

Kubernetes Secrets have some limitations and it's generally
recommended to familiarize with the [security
properties](https://kubernetes.io/docs/concepts/configuration/secret/#security-properties)
and risks. Secret encryption has to be enabled and [Sealed
Secrets](https://github.com/bitnami-labs/sealed-secrets) are useful
when it's necessary to commit manifests to a version control system.

[PodSecurityPolicy](https://kubernetes.io/docs/concepts/policy/pod-security-policy/)
can be used for constraining container runtime. Default permissions
are quite open and usually not necessary for large number
applications. General good practices for `PSP` include restricting
privileged containers, unnecessary risky mounts and device
access. It's also recommended to restrict root and privilege
escalation and have a read-only file system inside
containers. Additional `SELinux`, `AppArmor` or `seccomp` profiles can
be used to define fine-granular restrictions for applications running
inside containers. Pod's
[securityContext](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)
can be used to define the same settings on the pod level.

Network isolation for pods can be ensured via
[NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
resources. Most common network plugins (`kubenet` and `flannel`) can't
restrict communication between pods which means that all cluster pods
can discover and communicate with each other, [alternative
plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/)
should be used. `NetworkPolicy` is scoped by a namespace and contains
list of rules that define allowed traffic to selected pods. Implicit
deny rule will be applied for traffic that was not explicitly
whitelisted upon policy deployment. General recommendation is to
minimize allowed traffic to specific ports and pods instead of broader
per namespace policies.

While not strictly related to the security, [resource
limits](https://kubernetes.io/docs/tasks/configure-pod-container/quality-service-pod/)
on pods can prevent certain attacks and overall a good practice for
managing deployment environments.

It might be hard to keep an eye on all settings that were mentioned
above. [kubeaudit](https://github.com/Shopify/kubeaudit) can help with
automated manifests testing, it can also do checks against a container
or a cluster.

As I mentioned at the start of this post, it might be hard to reason
about `k8s` security as a whole. Once broken down to a smaller pieces
it's noticeable that while problem is still complex it can be
addressed gradually and provided tools are quite powerful for securing
application runtime. It's definitely worth spending some time learning
a bit more to avoid common pitfalls.
