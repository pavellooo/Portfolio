/*
* Name: Logan Pavelschak
* Date: 11/1/2024
* Purpose: Develop 2 hash tables, one with separate chaining and one with double hashing
*/

#include <iostream>
#include <list>
using namespace std;

class HashTable {
private:
    list<int>* table;
    int total_elements;
    // Hash function to calculate hash for a value:
    int getHash(int key) {
        return key % total_elements;
    }

public:
    // Constructor to create a hash table with 'n' indices:
    HashTable(int n) {
        total_elements = n;
        table = new list<int>[total_elements];
    }

    // Insert data in the hash table:
    void insertElement(int key) {
        //calculate hash, and use list's push back function to insert
        int bucket_index = getHash(key);
        table[bucket_index].push_back(key);
    }

    // Remove data from the hash table:
    void removeElement(int key) {
        //calculate hash, iterate through linked list until key is found, and erase it
        int bucket_index = getHash(key);
        for (auto i = table[bucket_index].begin(); i != table[bucket_index].end(); i++) {
            if (*i == key) {
                i = table[bucket_index].erase(i);
            }
        }
    }

    void printAll() {
        //loop through table, output linked lists
        for (int i = 0; i < total_elements; ++i) {
            cout << "Index " << i << ": ";
            for (int value : table[i]) {
                cout << value << " => ";
            }
            cout << endl;
        }
    }
};



class HashTable2 {
    //implement the entire HashTable2 using doubel hashing. You need to implement insertElement(), removeElement(), and printALL(). 
    //Use key % total_elements as first hash function, and 7 - (key % 7) as second hash function. 
private:
    int* table;
    int total_elements;
    //hash function to calculate hash value for insert operation
    int getHash(int key) {
        int hash = key % total_elements;
        int i = 1;
        //while the hash bucket is full, recalculate 
        while (table[hash] != 0 && table[hash] != -1) { //note: 0 is initially empty, -1 means empty after removal
            hash = (hash + i * (7 - (key % 7))) % total_elements;
            i++;
        }
        return hash;
    }
public:
    //constructor
    HashTable2(int n) {
        total_elements = n;
        table = new int[n];
        //initialize all elements of new table to 0, 0 meaning initially empty
        for (int i = 0; i < n; i++) {
            table[i] = 0;
        }
    }
    //insert data in the hash table
    void insertElement(int key) {
        int hash = getHash(key);
        table[hash] = key;
    }
    //remove data from hash table
    void removeElement(int key) {
        int hash = key % total_elements;
        int i = 1;
        //loop to keep looking for a key using the double hashing method
        while (table[hash] != 0) {
            //if found, remove it and return
            if (table[hash] == key) {
                table[hash] = -1; //note: -1 means empty after removal
                return;
            }
            //else, calculate new hash and try again
            hash = (hash + i * (7 - (key % 7))) % total_elements;
            i++;
            //check for full table 
            if (i > total_elements) { 
                cout << "Error: Key " << key << " not found" << endl;
                return; 
            }
        }
    }
    //print the hash table
    void printAll() {
        //iterate through array linearly, output
        for (int i = 0; i < total_elements; i++) {
            //if bucket is empty, print empty
            if (table[i] == -1 || table[i] == 0) {
                cout << "Index " << i << ": " << endl;
            }
            else { //else there is data, print it
                cout << "Index " << i << ": " << table[i] << endl;
            }
        }
    }

};


int main() {

    // Create a hash table with 11 indices:
    HashTable ht(11);
    // Declare the data to be stored in the hash table:
    int arr[] = { 2, 8, 19, 20, 26 };

    // Insert the whole data into the hash table:
    for (int i = 0; i < 5; i++)
        ht.insertElement(arr[i]);

    cout << "..:: Hash Table with separate chaining::.." << endl;
    ht.printAll();

    ht.removeElement(8);
    cout << endl << "..:: After deleting 8 ::.." << endl;
    ht.printAll();
    cout << endl;
    cout << "*************************************************************************" <<endl;

    // Create a hash table with 11 indices:
    HashTable2 ht2(11);

    // Declare the data to be stored in the hash table:
    int arr2[] = { 2, 8, 19, 20, 26 };

    // Insert the whole data into the hash table:
    for (int i = 0; i < 5; i++)
        ht2.insertElement(arr2[i]);

    cout << "..:: Hash Table with double hashing::.." << endl;
    ht2.printAll();

    ht2.removeElement(8);
    cout << endl << "..:: After deleting 8 ::.." << endl;
    ht2.printAll();
    
    return 0;

 
}