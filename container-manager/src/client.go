package main

import (
	"encoding/json"
	"fmt"
	appsv1 "k8s.io/api/apps/v1"
	apiv1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"net/http"
	"strconv"
	"strings"
)

func getNoOfPods(w http.ResponseWriter, r *http.Request) {
	config, err := rest.InClusterConfig()
	if err != nil {
		panic(err.Error())
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		panic(err.Error())
	}

	pods, err := clientset.CoreV1().Pods("").List(metav1.ListOptions{})
	if err != nil {
		panic(err.Error())
	}

	w.Write([]byte(fmt.Sprintf("There are %d pods in the cluster\n", len(pods.Items))))
}

func createMapFns(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Could not parse form.", http.StatusBadRequest)
			return
		}
		imagePath := r.PostForm.Get("imagePath")
		fnName := r.PostForm.Get("fnName")
		replicas, _ := strconv.Atoi(r.PostForm.Get("replicas"))

		startContainers(imagePath, fnName, replicas)
	}
}

func startContainers(imagePath string, fnName string, replicas int) {
	rep32 := int32(replicas)
	config, err := rest.InClusterConfig()
	if err != nil {
		panic(err.Error())
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		panic(err.Error())
	}
	deploymentsClient := clientset.AppsV1().Deployments(apiv1.NamespaceDefault)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name: fnName,
		},
		Spec: appsv1.DeploymentSpec{
			MinReadySeconds: 5,
			Replicas:        int32Ptr(rep32),
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"name": fnName,
				},
			},
			Template: apiv1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"name": fnName,
					},
				},
				Spec: apiv1.PodSpec{
					Containers: []apiv1.Container{
						{
							Name:  fnName,
							Image: imagePath,
							Ports: []apiv1.ContainerPort{
								{
									Name:          "http",
									Protocol:      apiv1.ProtocolTCP,
									ContainerPort: 8000,
								},
							},
						},
					},
				},
			},
		},
	}
	result, err := deploymentsClient.Create(deployment)

	if err != nil {
		fmt.Println(err)
		for err != nil && strings.HasPrefix(err.Error(), "object is being deleted") {
			result, err = deploymentsClient.Create(deployment)
		}
	}

	fmt.Printf("Created deployment %q.\n", result.GetObjectMeta().GetName())

	servicesClient := clientset.CoreV1().Services(apiv1.NamespaceDefault)
	service := &apiv1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name: fnName,
		},
		Spec: apiv1.ServiceSpec{
			Selector: map[string]string{
				"name": fnName,
			},
			Ports: []apiv1.ServicePort{
				{
					Port:       80,
					TargetPort: intstr.FromInt(8000),
				},
			},
			Type: apiv1.ServiceTypeClusterIP,
		},
	}
	serviceResult, err := servicesClient.Create(service)
	if err != nil {
		panic(err)
	}

	fmt.Printf("Created service %q.\n", serviceResult.GetObjectMeta().GetName())
}

func isFnRunning(fnName string) bool {
	config, err := rest.InClusterConfig()
	if err != nil {
		panic(err.Error())
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		panic(err.Error())
	}

	deploymentResult, err := clientset.AppsV1().Deployments(apiv1.NamespaceDefault).Get(fnName, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		fmt.Println("Replicas missing")
		return false
	} else if deploymentResult.Status.AvailableReplicas > 0 {
		fmt.Println("Replicas are available")
		return true
	} else {
		fmt.Println("Replicas were not available")
		return false
	}
}

type FnStatus struct {
	Status string `json:"fnStatus"`
}

func getFnStatus(w http.ResponseWriter, r *http.Request) {
	fnName := r.URL.Query().Get("fnName")

	w.Header().Set("Content-Type", "application/json")

	if isFnRunning(fnName) {
		fn_status := FnStatus{
			Status: "Running",
		}
		json.NewEncoder(w).Encode(fn_status)
	} else {
		fn_status := FnStatus{
			Status: "Missing",
		}
		json.NewEncoder(w).Encode(fn_status)
	}
}

func int32Ptr(i int32) *int32 { return &i }

func deleteMapFns(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Could not parse form.", http.StatusBadRequest)
			return
		}
		fnName := r.PostForm.Get("fnName")

		deletePolicy := metav1.DeletePropagationForeground

		config, err := rest.InClusterConfig()
		if err != nil {
			panic(err.Error())
		}

		clientset, err := kubernetes.NewForConfig(config)
		if err != nil {
			panic(err.Error())
		}
		deploymentsClient := clientset.AppsV1().Deployments(apiv1.NamespaceDefault)
		_ = deploymentsClient.Delete(fnName, &metav1.DeleteOptions{PropagationPolicy: &deletePolicy})
		fmt.Println("Deleted deployment.")

		servicesClient := clientset.CoreV1().Services(apiv1.NamespaceDefault)
		_ = servicesClient.Delete(fnName, &metav1.DeleteOptions{PropagationPolicy: &deletePolicy})
		fmt.Println("Deleted service.")
	}
}
