/*
// Author: Logan Pavelschak
// Date: 9/27/24
// Purpose: test out many sorting algorithms on a password.txt file, and 
// put them into ascending order and make comparisons of algorithms
*/

#include <string>
#include <stdio.h>
#include <stdlib.h>
#include <iostream>
#include <fstream>
using namespace std;

//declare public constant
const int MAX_STRINGS = 10000; 

// load passwords will overwrite the passwords array every time 
// so that a new sorting algorithm can be run from scratch and have
// a fair comparison
void loadPasswords(string* arr) {
	// create ifstream and input variable
	ifstream file("Passwords.txt");
	string input;

	// check if file failed to open
	if (!file) {
		cerr << "Error opening file" << endl;
		return;
	}

	// load all of the passwords into an array, and exit if fewer 
	// lines are in the file than the const value
	int i = 0;
	while (getline(file, input) && i < MAX_STRINGS) {
		arr[i] = input;
		i++;
	}

	// close file
	file.close();
}

// swap method, used for most of these sorting algorithms
void swap(string* a, string* b) {
	string temp = *a;
	*a = *b;
	*b = temp;
}

void BubbleSort(string* arr, int n) {
	int comparisonCounter = 0;
	int movementCounter = 0;
	//move the largest unsorted element to its correct position, and repeat with a smaller range
	for (int i = 0; i < n - 1; i++) {
		for (int j = 0; j < n - i - 1; j++) {
			if (arr[j] > arr[j + 1]) { 
				swap(&arr[j], &arr[j + 1]);
				movementCounter += 3; // 3 movements because of swap method
			}
			comparisonCounter++;
		}
	}
	//output
	cout << "Bubble Sort:" << endl;
	cout << "Number of Comparisons: " << comparisonCounter << endl;
	cout << "Number of Movements: " << movementCounter << "\n" << endl;
}

void SelectionSort(string* arr, int n) {
	int comparisonCounter = 0;
	int movementCounter = 0;

	for (int i = 0; i < n - 1; i++) {
		// find the smallest element in the unsorted array
		int indexSmallest = i;
		for (int j = i + 1; j < n; j++) { 
			if (arr[j] < arr[indexSmallest]) {
				indexSmallest = j;
			}
			comparisonCounter++;
		}
		//swap the smallest element to its correct position
		swap(&arr[i], &arr[indexSmallest]);
		movementCounter += 3; // 3 movements because of swap method
	}
	// output
	cout << "Selection Sort:" << endl;
	cout << "Number of Comparisons: " << comparisonCounter << endl;
	cout << "Number of Movements: " << movementCounter << "\n" << endl;
}

void InsertionSort(string* arr, int n) {
	int comparisonCounter = 0;
	int movementCounter = 0;

	for (int i = 1; i < n; i++) {
		int j = i;
		// shift elements to the sorted part of the array
		while (j > 0) {
			comparisonCounter++; 
			if (arr[j] < arr[j - 1]) {
				swap(arr[j], arr[j - 1]);
				movementCounter += 3; // 3 movements counted per swap
			}
			else {
				break; //exit loop early if no swap is needed
			}
			j--;
		}
	}
	// output
	cout << "Insertion Sort:" << endl;
	cout << "Number of Comparisons: " << comparisonCounter << endl;
	cout << "Number of Movements: " << movementCounter << "\n" << endl;
}
// helping algorithm for MergeSort
void Merge(string* arr, int leftFirst, int leftLast, int rightLast, int& comparisonCount, int& movementCount) {
	int mergedSize = rightLast - leftFirst + 1;
	string* mergedNumbers = new string[mergedSize];
	int mergePos = 0;
	int leftPos = leftFirst;
	int rightPos = leftLast + 1;

	// merge the 2 sorted subarrays together into the temporary array mergedNumbers
	while (leftPos <= leftLast && rightPos <= rightLast) {
		comparisonCount++;
		if (arr[leftPos] <= arr[rightPos]) {
			mergedNumbers[mergePos] = arr[leftPos];
			leftPos++;
		}
		else {
			mergedNumbers[mergePos] = arr[rightPos];
			rightPos++;
		}
		mergePos++;
		movementCount++;
	}
	// add all leftover elements from the left array
	while (leftPos <= leftLast) {
		mergedNumbers[mergePos] = arr[leftPos];
		leftPos++;
		mergePos++;
		movementCount++;
	}
	// add all leftover elements from the right array
	while (rightPos <= rightLast) {
		mergedNumbers[mergePos] = arr[rightPos];
		rightPos++;
		mergePos++;
		movementCount++;
	}
	// copy the merged array back to the original array
	for (mergePos = 0; mergePos < mergedSize; mergePos++) {
		arr[leftFirst + mergePos] = mergedNumbers[mergePos];
		movementCount++;
	}
	// free the dynamically allocated memory of the temporary array
	delete[] mergedNumbers;
}

void MergeSort(string* arr, int l, int r, int& comparisonCount, int& movementCount) {
	if (l < r) {
		// Find the midpoint in the partition
		int mid = (l + r) / 2;

		// Recursively sort left and right partitions
		MergeSort(arr, l, mid, comparisonCount, movementCount);
		MergeSort(arr, mid + 1, r, comparisonCount, movementCount);

		// Merge left and right partition in sorted order
		Merge(arr, l, mid, r, comparisonCount, movementCount);
	}
}

// calculate median of 3, helper algorithm for quicksort
int medianOfThree(string arr[], int low, int high, int& comparisonCount, int& movementCount) {
	// calculate midpoint
	int mid = low + (high - low) / 2;

	// sort first/middle/last elements
	if (arr[low] > arr[mid]) {
		swap(arr[low], arr[mid]);
		movementCount++;
	}
	if (arr[low] > arr[high]) {
		swap(arr[low], arr[high]);
		movementCount++;
	}
	if (arr[mid] > arr[high]) {
		swap(arr[mid], arr[high]);
		movementCount++;
	}
	comparisonCount += 3; // 3 comparisons were made
	

	// Move the pivot (middle element) just before the high index
	swap(arr[mid], arr[high - 1]);
	movementCount++;

	// Return the index of the good pivot that was just calculated
	return high - 1;
}

// Partition the function using the median of 3 pivot, also a helper algorithm for quick sort
int partition(string arr[], int low, int high, int& comparisonCount, int& movementCount) {
	// Get the pivot index using the median of 3 method
	int pivotIndex = medianOfThree(arr, low, high, comparisonCount, movementCount);
	string pivot = arr[pivotIndex];  // pivot element
	
	int i = low - 1;
	for (int j = low; j <= high - 2; j++) { // loop until before pivot (high - 2)
		if (arr[j] <= pivot) { // put elements less than pivot on the left
			i++;
			swap(arr[i], arr[j]);
			movementCount++;
		}
		comparisonCount++;
	}

	// pivot swap at end
	swap(arr[i + 1], arr[high - 1]);
	movementCount++;

	return i + 1;
}

void QuickSort(string* arr, int low, int high, int& comparisonCount, int& movementCount) {
	if (low < high) {
		int pivot = partition(arr, low, high, comparisonCount, movementCount); //partition array

		QuickSort(arr, low, pivot - 1, comparisonCount, movementCount); //sort left
		QuickSort(arr, pivot + 1, high, comparisonCount, movementCount); //sort right
	}
}

int main() {
	// declare array
	string passwords[MAX_STRINGS];
	
	// call sorting algorithms, load/overwrite the array each time with loadPasswords() for a fair sort
	
	loadPasswords(passwords);
	BubbleSort(passwords, MAX_STRINGS);

	loadPasswords(passwords);
	SelectionSort(passwords, MAX_STRINGS);
	
	loadPasswords(passwords);
	InsertionSort(passwords, MAX_STRINGS);

	// merge sort needs counter variables passed by reference because it
	// is recursively implemented and very difficult to track counts
	int comparisonCount = 0;
	int movementCount = 0;

	//run merge sort with freshly reloaded list
	loadPasswords(passwords);
	MergeSort(passwords, 0, MAX_STRINGS - 1, comparisonCount, movementCount);

	// outputs are here to prevent issues with recursively outputting multiple times
	cout << "Merge Sort:" << endl;
	cout << "Number of Comparisons: " << comparisonCount << endl;
	cout << "Number of Movements: " << movementCount << "\n" << endl;

	// quick sort also needs the variable by reference because of recursion
	comparisonCount = 0;
	movementCount = 0;

	//run quick sort with freshly reloaded list
	loadPasswords(passwords);
	QuickSort(passwords, 0, MAX_STRINGS - 1, comparisonCount, movementCount);

	// output quicksort results, similar to Merge sort
	cout << "Quick Sort:" << endl;
	cout << "Number of Comparisons: " << comparisonCount << endl;
	cout << "Number of Movements: " << movementCount << "\n" << endl;

	return 0;
}
