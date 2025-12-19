// random_numbers.cpp : This file contains the 'main' function. Program execution begins and ends there

#include <iostream>
#include <cstdlib>
#include <algorithm>
#include <chrono>
#include <vector>
#include "number_data.h"
#include <fstream>

using namespace std;
using namespace std::chrono;

void fill_random_numbers (int arr [], const unsigned int SIZE)
{
	// Pre:  SIZE is no more than a million, arr has been declared to be
	//       an array of at least SIZE elements.
	// Post: The first SIZE elements of the array arr have been populated with
	//       random integers between 0 and one million.

	for (int i = 0; i < SIZE; i++)
	{
		arr[i] = round(rand() / double(RAND_MAX) * 1000000);
	}
}

void fill_sorted_numbers (int asc [], int dsc [], const unsigned int SIZE)
{
	// Pre:  SIZE is no more than a million, and asc and dsc have been declared
	//       to be arrays of at least SIZE elements.
	// Post: The first SIZE elements of the array asc have been populated with
	//       integers between 0 and one million in ascending order, and dsc has
	//       the same numbers in descending order.

	int step = 1000000 / SIZE;

	for (int i = 0; i < SIZE; i++)
	{
		asc[i] = dsc [SIZE-1-i] = step*i;
	}
}

//sorting algorithms:

int BubbleSort(int arr[], int n) {
	high_resolution_clock::time_point t1 = high_resolution_clock::now();
	int numComparisons = 0;
	int range = n;
	// Tracks the last swap position
	int lastSwap; 
	do {
		// Reset last swap position
		lastSwap = 0; 
		for (int i = 1; i < range; ++i) {
			++numComparisons;
			// Swap when needed
			if (arr[i - 1] > arr[i]) { 
				swap(arr[i - 1], arr[i]);
				// save last swap position
				lastSwap = i;
			}
		}
		// Reduce the range to where the last swap happened
		range = lastSwap; 
	} while (lastSwap > 0); // Continue if swaps occurred
	high_resolution_clock::time_point t1 = high_resolution_clock::now();
	high_resolution_clock::time_point t2 = high_resolution_clock::now();
	duration<double> timeSpan = duration_cast<duration<double>>(t2 - t1);
	cout << "time for BubbleSort: " << timeSpan.count() << " seconds" << endl;

	return numComparisons;
}

int InsertionSort(int arr[], int n) {
	high_resolution_clock::time_point t1 = high_resolution_clock::now();
	int numComparisons = 0;

	for (int i = 1; i < n; ++i) {
		int key = arr[i];
		int j = i - 1;

		while (j >= 0) {
			++numComparisons;  
			if (arr[j] > key) {
				arr[j + 1] = arr[j];
				j = j - 1;
			}
			else { // Once no swap is needed, exit early
				break; 
			}
		}
		arr[j + 1] = key;
	}

	high_resolution_clock::time_point t2 = high_resolution_clock::now();
	duration<double> timeSpan = duration_cast<duration<double>>(t2 - t1);
	cout << "time for InsertionSort: " << timeSpan.count() << " seconds" << endl;

	return numComparisons;
}

int partition(int arr[], int low, int high, int& comparisonCount) {
	int mid = low + (high - low) / 2;

	// Median-of-three selection, sorts the 3 elements to get arr[mid] (the best pivot) in the middle
	if (arr[low] > arr[mid]) {
		swap(arr[low], arr[mid]);
	}
	if (arr[mid] > arr[high]) {
		swap(arr[mid], arr[high]);
	}
	if (arr[low] > arr[mid]) {
		swap(arr[low], arr[mid]);
	}
	comparisonCount += 3;

	// Now arr[mid] is the median, swap it to the end
	swap(arr[mid], arr[high]);
	int pivot = arr[high];

	// Partition, note that i is like the midpoint between the high and low partitions
	int i = low - 1;
	for (int j = low; j < high; j++) {
		++comparisonCount;
		if (arr[j] < pivot) {
			i++;
			swap(arr[i], arr[j]);
		}
	}

	// Place pivot in correct position (end of the range)
	swap(arr[i + 1], arr[high]);
	return i + 1;
}

// recursive Quicksort
void QuickSort(int arr[], int low, int high, int& comparisonCount) {
	// Base case, comparing indices (not elements, so by the criteria it doesn't get added to the counter)
	if (low < high) {
		// pi is the partition return index of pivot
		int pi = partition(arr, low, high, comparisonCount);
		// Recursive calls
		QuickSort(arr, low, pi - 1, comparisonCount);
		QuickSort(arr, pi + 1, high, comparisonCount);
	}
}

// Quicksort helper function, so that we can have both a timer and comparison counter for the recursive function
int QuickSortHelper(int arr[], int n) {
	high_resolution_clock::time_point t1 = high_resolution_clock::now();
	int comparisonCount = 0;

	QuickSort(arr, 0, n - 1, comparisonCount);

	high_resolution_clock::time_point t2 = high_resolution_clock::now();
	duration<double> timeSpan = duration_cast<duration<double>>(t2 - t1);
	cout << "time for QuickSort with median of 3: " << timeSpan.count() << " seconds" << endl;

	return comparisonCount;
}

void heapify(int arr[], int n, int i, int& comparisonCount) {
	// Calculating left/right children
	int largest = i;
	int l = 2 * i + 1;
	int r = 2 * i + 2;

	// If left child is larger than root
	if (l < n) {
		++comparisonCount;
		if (arr[l] > arr[largest])
			largest = l;
	}
	// If right child is larger than current largest 
	if (r < n) {
		++comparisonCount;
		if (arr[r] > arr[largest])
			largest = r;
	}
	// Swap if needed and recursively heapify
	if (largest != i) {
		swap(arr[i], arr[largest]);
		heapify(arr, n, largest, comparisonCount);
	}
}

int HeapSort(int arr[], int n) {
	high_resolution_clock::time_point t1 = high_resolution_clock::now();
	int numComparisons = 0;

	// Build max heap (rearrange the array)
	for (int i = n / 2 - 1; i >= 0; i--)
		heapify(arr, n, i, numComparisons);

	// One at a time, extract an element from heap
	for (int i = n - 1; i > 0; i--) {
		// Move current root to end
		swap(arr[0], arr[i]);
		// Heapify the reduced heap
		heapify(arr, i, 0, numComparisons);
	}

	high_resolution_clock::time_point t2 = high_resolution_clock::now();
	duration<double> timeSpan = duration_cast<duration<double>>(t2 - t1);
	cout << "time for HeapSort: " << timeSpan.count() << " seconds" << endl;

	return numComparisons;
}

// Merge function for 3-way merge sort
void merge(int arr[], int left, int mid1, int mid2, int right, int& comparisonCount) {
	// Sizes of the three subarrays
	int size1 = mid1 - left + 1;
	int size2 = mid2 - mid1;
	int size3 = right - mid2;

	// Temporary vectors the for three subarrays
	vector<int> leftArr(size1), midArr(size2), rightArr(size3);

	// Copy data to temporary arrays (vectors)
	for (int i = 0; i < size1; i++) {
		leftArr[i] = arr[left + i];
	}
	for (int i = 0; i < size2; i++) {
		midArr[i] = arr[mid1 + 1 + i];
	}
	for (int i = 0; i < size3; i++) {
		rightArr[i] = arr[mid2 + 1 + i];
	}

	// Merge the arrays in O(n) time
	int i = 0, j = 0, k = 0, index = left;
	while (i < size1 || j < size2 || k < size3) {
		++comparisonCount;

		if (i < size1 && (j >= size2 || leftArr[i] <= midArr[j]) && (k >= size3 || leftArr[i] <= rightArr[k])) {
			arr[index++] = leftArr[i++];
		}
		else if (j < size2 && (k >= size3 || midArr[j] <= rightArr[k])) {
			arr[index++] = midArr[j++];
		}
		else {
			arr[index++] = rightArr[k++];
		}
	}
}

void threeWayMergeSort(int arr[], int left, int right, int& comparisonCount) {
	// Base case
	if (left >= right) 
		return;
	
	// Finding two midpoints for 3-way split
	int mid1 = left + (right - left) / 3;
	int mid2 = mid1 + (right - mid1) / 2;

	// Recursive sorting calls on all 3 sections
	threeWayMergeSort(arr, left, mid1, comparisonCount);
	threeWayMergeSort(arr, mid1 + 1, mid2, comparisonCount);
	threeWayMergeSort(arr, mid2 + 1, right, comparisonCount);

	// Merge the sorted parts
	merge(arr, left, mid1, mid2, right, comparisonCount);
}

// Helper function to allow for tracking of time and comparison count on the recursive function
int MergeSortHelper(int arr[], int n) {
	high_resolution_clock::time_point t1 = high_resolution_clock::now();
	int comparisonCount = 0;

	threeWayMergeSort(arr, 0, n - 1, comparisonCount);

	high_resolution_clock::time_point t2 = high_resolution_clock::now();
	duration<double> timeSpan = duration_cast<duration<double>>(t2 - t1);
	cout << "time for 3 Way Merge Sort: " << timeSpan.count() << " seconds" << endl;

	return comparisonCount;
}

const unsigned int SIZE = 8000;

int main()
{
	int numbers [SIZE];
	int increasing [SIZE];
	int decreasing [SIZE];

	fill_random_numbers (numbers, SIZE);
	fill_sorted_numbers (increasing, decreasing, SIZE);

	// NOW apply sorting algorithms to a copy of each array or copy of a slice of the array.
	
	// Save the 3 data sets to an external file
	ofstream DataSetFile("DataSets.txt"); 

	if (DataSetFile.is_open()) {
		DataSetFile << "Random Numbers: \n";
		for (int num : numbers) {
			DataSetFile << num << " ";
		}
		DataSetFile << "\n\n";

		DataSetFile << "Increasing Numbers: \n";
		for (int num : increasing) {
			DataSetFile << num << " ";
		}
		DataSetFile << "\n\n";

		DataSetFile << "Decreasing Numbers: \n";
		for (int num : decreasing) {
			DataSetFile << num << " ";
		}
		DataSetFile << endl;

		DataSetFile.close();
	}
	else {
		cerr << "error opening file DataSets.txt" << endl;
	}

	// Note that the same data set will be used for all tests for consistency, using copies and slices of it

	const unsigned int sizes[] = { 1000, 2000, 4000, 8000 };
	// Outer loop runs 4 times, 1 for each data set size
	for (int i = 0; i < 4; i++) { 
		int currentSize = sizes[i];
		cout << "Runs for size " << currentSize << ":\n" << endl;
		
		int* currentData = nullptr;
		string dataType;
		// inner loop runs 3 times, 1 for each case (random, increasing, and decreasing)
		for (int j = 0; j < 3; j++) { 
			if (j == 0) {
				currentData = numbers;
				dataType = "random";
			}
			else if (j == 1) {
				currentData = increasing;
				dataType = "increasing";
			}
			else {
				currentData = decreasing;
				dataType = "decreasing";
			}

			cout << dataType << ": " << endl;

			// Copy data into a temporary array, run a sorting algorithm, output, copy data again 
			// into the array, and repeat for the rest of the sorting algorithms
			int temp[8000];

			// Bubble Sort
			copy(currentData, currentData + currentSize, temp);
			cout << "Bubble sort " << dataType << " comparison count: " << BubbleSort(temp, currentSize) << endl;

			// Insertion Sort
			copy(currentData, currentData + currentSize, temp);
			cout << "Insertion sort " << dataType << " comparison count: " << InsertionSort(temp, currentSize) << endl;

			// Quick Sort with median of 3 pivot selection
			copy(currentData, currentData + currentSize, temp);
			cout << "Quick sort (with median of 3 pivot selection) " << dataType << " comparison count: " << QuickSortHelper(temp, currentSize) << endl;

			// Heap Sort
			copy(currentData, currentData + currentSize, temp);
			cout << "Heap sort " << dataType << " comparison count: " << HeapSort(temp, currentSize) << endl;

			// 3 way Merge sort
			copy(currentData, currentData + currentSize, temp);
			cout << "3-way Merge sort " << dataType << " comparison count: " << MergeSortHelper(temp, currentSize) << endl;

			cout << endl;
		}
		cout << endl;
	}

	return 0;
}
